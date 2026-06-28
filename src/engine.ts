import { Effect, Layer, PubSub } from 'effect'
import { Supervisor, type WorkerLifecycleEvent } from './supervisor.ts'
import type { WorkerId } from './workerId.ts'
import { PluginRegistry } from './pluginRegistry.ts'
import { Message, type WorkerMessage } from './protocol.ts'
import type { RuntimePermission } from './runtimePermission.ts'
import { ItemNotFoundError, Storage, StorageError } from './storage.ts'
import type { Host } from './host.ts'
import type { InstallPlugin, PluginMetadata } from './plugin.ts'

export function ephemeralStorage(): AsyncStorageImpl {
  const store = new Map<string, unknown>()

  return {
    get: (key: string) => Promise.resolve(store.get(key)),
    set: (key: string, value: unknown) => {
      store.set(key, value)
      return Promise.resolve()
    }
  }
}

export function engine<H extends Host<any>>(
  options: EngineOptions<H>
): EngineInstance {
  const storage = Storage.of({
    get: (key: string) =>
      Effect.tryPromise({
        try: () => options.storage.get(key),
        catch: (cause) => new StorageError({ cause })
      }).pipe(
        Effect.filterOrFail((result) => result !== undefined, () =>
          new ItemNotFoundError({ key }))
      ),
    set: (key: string, value: unknown) =>
      Effect.tryPromise({
        try: () => options.storage.set(key, value),
        catch: (cause) => new StorageError({ cause })
      })
  })

  const layers = Engine.Default.pipe(
    Layer.provide(Supervisor.Default),
    Layer.provide(PluginRegistry.Default),
    Layer.provide(Layer.succeed(Storage, storage))
  )

  const start = Engine.pipe(
    Effect.flatMap((engine) => engine.start()),
    Effect.provide(layers),
    Effect.orDie
  )

  const install = (plugin: InstallPlugin) =>
    Engine.pipe(
      Effect.flatMap((engine) => engine.install(plugin)),
      Effect.provide(layers),
      Effect.orDie
    )

  return {
    start: () => Effect.runPromise(start).then(() => undefined),
    install: (plugin: InstallPlugin) => Effect.runPromise(install(plugin))
  } as const
}

export class Engine extends Effect.Service<Engine>()(
  'Engine',
  {
    scoped: Effect.gen(function* () {
      const pluginRegistry = yield* PluginRegistry
      const supervisor = yield* Supervisor
      const workerMessages = yield* PubSub.unbounded<WorkerMessage>()
      const workerLifecycleEvents = yield* PubSub.unbounded<
        WorkerLifecycleEvent
      >()

      const plugins = yield* pluginRegistry.getInstalledPlugins()

      function dispatchOnInstall(
        workerId: WorkerId,
        pluginManifest: PluginMetadata
      ) {
        return supervisor.notify(
          workerId,
          Message.make({
            id: crypto.randomUUID(),
            event: PluginRegistry.CONSTANTS.OnInstall,
            payload: pluginManifest
          })
        )
      }

      function dispatchOnStart(
        workerId: WorkerId,
        pluginManifest: PluginMetadata
      ) {
        return supervisor.notify(
          workerId,
          Message.make({
            id: crypto.randomUUID(),
            event: PluginRegistry.CONSTANTS.OnStart,
            payload: pluginManifest
          })
        )
      }

      function start() {
        return Effect.forEach(
          plugins,
          (plugin) =>
            supervisor.start({
              pluginManifest: plugin,
              grantedRuntimePermissions: plugin
                .grantedRuntimePermissions as RuntimePermission[],
              workerMessages,
              workerLifecycleEvents
            }).pipe(
              Effect.flatMap(
                (process) => dispatchOnStart(process.id, plugin)
              )
            ),
          {
            concurrency: 'unbounded'
          }
        )
      }

      function install(plugin: InstallPlugin) {
        return Effect.gen(function* () {
          yield* pluginRegistry.installPlugin(plugin)

          const process = yield* supervisor.start({
            pluginManifest: plugin,
            grantedRuntimePermissions: plugin
              .grantedRuntimePermissions as RuntimePermission[],
            workerLifecycleEvents,
            workerMessages
          })
          yield* dispatchOnInstall(process.id, plugin)

          yield* supervisor.interrupt(process.id)
        })
      }

      return {
        start,
        supervisor,
        pluginRegistry,
        install
      } as const
    })
  }
) {
}

type AsyncStorageImpl = {
  /**
   * Retrieves a value from storage by its key. Returns a promise that resolves
   * to the value, or undefined if the key does not exist.
   */
  get: (key: string) => Promise<unknown | undefined>

  /**
   * Stores a value in storage under the specified key. Returns a promise that
   * resolves when the value has been successfully stored.
   */
  set: (key: string, value: unknown) => Promise<void>
}

export type EngineInstance = {
  start: () => Promise<void>
  install: (plugin: InstallPlugin) => Promise<void>
}

export type EngineOptions<H extends Host<any>> = {
  /**
   * The host application.
   */
  host: H

  /**
   * An implementation of asynchronous storage that the engine can use to
   * persistdata across sessions. This storage implementation must provide `get`
   * and `set` methods that return promises, allowing the engine to store and
   * retrieve data as needed.
   */
  storage: AsyncStorageImpl
}
