import { Effect, Layer, PubSub } from 'effect'
import { Supervisor } from './supervisor.ts'
import { PluginRegistry } from './pluginRegistry.ts'
import type { WorkerMessage } from './protocol.ts'
import type { RuntimePermission } from './runtimePermission.ts'
import { ItemNotFoundError, Storage, StorageError } from './storage.ts'
import type { Host } from './host.ts'

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

export function engine<H extends Host<any>>(options: EngineOptions<H>) {
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

  return {
    start: () => Effect.runPromise(start)
  } as const
}

export class Engine extends Effect.Service<Engine>()(
  'Engine',
  {
    scoped: Effect.gen(function* () {
      const pluginRegistry = yield* PluginRegistry
      const supervisor = yield* Supervisor
      const ps = yield* PubSub.unbounded<WorkerMessage>()

      const consumer = yield* PubSub.subscribe(ps)

      const plugins = yield* pluginRegistry.getInstalledPlugins()

      function start() {
        return Effect.forEach(
          plugins,
          (plugin) =>
            supervisor.start({
              pluginManifest: plugin,
              givenRuntimePermissions: plugin
                .givenRuntimePermissions as RuntimePermission[],
              ps
            }),
          {
            concurrency: 'unbounded'
          }
        )
      }

      return {
        start,
        supervisor,
        pluginRegistry
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
