import { Effect, Exit, Layer } from 'effect'
import { Engine } from './engine.ts'
import { Supervisor } from './supervisor.ts'
import { PluginRegistry } from './pluginRegistry.ts'
import { ItemNotFoundError, Storage, StorageError } from './storage.ts'
import { PluginManifest } from './plugin.ts'
import { assert, assertEquals } from '@std/assert'
import { LoggerLayer, MinimumLogLevelLayer } from './log.ts'

const installTestPlugin = {
  ...PluginManifest.make({
    id: 'install-test',
    name: 'Install Test Plugin',
    requestPermissions: [],
    path: '../test-workers/testWorker.ts',
    supportedVersions: ['1.0.0'],
    version: '1.0.0'
  }),
  givenRuntimePermissions: [],
  givenPermissions: []
}

const installTestPlugin2 = {
  ...PluginManifest.make({
    id: 'install-test-2',
    name: 'Install Test Plugin 2',
    requestPermissions: [],
    path: '../test-workers/testWorker.ts',
    supportedVersions: ['1.0.0'],
    version: '1.0.0'
  }),
  givenRuntimePermissions: [],
  givenPermissions: []
}

const installTestPlugin3 = {
  ...PluginManifest.make({
    id: 'install-test-3',
    name: 'Install Test Plugin 3',
    requestPermissions: [],
    path: '../test-workers/testWorker.ts',
    supportedVersions: ['1.0.0'],
    version: '1.0.0'
  }),
  givenRuntimePermissions: [],
  givenPermissions: []
}

function ephemeralStorage() {
  const store = new Map<string, unknown>()

  const storage = Storage.of({
    get: (key: string) =>
      Effect.tryPromise({
        try: () => Promise.resolve(store.get(key)),
        catch: (cause) => new StorageError({ cause })
      }).pipe(
        Effect.filterOrFail(
          (result) => result !== undefined,
          () => new ItemNotFoundError({ key })
        )
      ),
    set: (key: string, value: unknown) =>
      Effect.tryPromise({
        try: () => {
          store.set(key, value)
          return Promise.resolve()
        },
        catch: (cause) => new StorageError({ cause })
      })
  })

  return { store, layer: Layer.succeed(Storage, storage) }
}

const runEngine = <A, E>(
  effect: Effect.Effect<A, E, any>,
  storageLayer: Layer.Layer<Storage, never, never>
) =>
  Effect.runPromiseExit(
    effect.pipe(
      Effect.provide(Engine.Default),
      Effect.provide(Supervisor.Default),
      Effect.provide(PluginRegistry.Default),
      Effect.provide(storageLayer),
      Effect.provide(LoggerLayer),
      Effect.provide(MinimumLogLevelLayer)
    ) as Effect.Effect<A, E, never>
  )

type SpyWorkerFactory = new (
  specifier: string | URL,
  options?: WorkerOptions
) => Worker

function withPostMessageSpy<T>(
  fn: (messages: unknown[]) => Promise<T>
): Promise<T> {
  const messages: unknown[] = []
  const OriginalWorker = globalThis.Worker

  class SpyWorker extends Worker {
    constructor(specifier: string | URL, options?: WorkerOptions) {
      super(specifier, options)
      const originalPostMessage = this.postMessage.bind(this)
      ;(this as any).postMessage = (msg: unknown, opts?: unknown) => {
        messages.push(msg)
        return originalPostMessage(msg, opts as any)
      }
    }
  }

  globalThis.Worker = SpyWorker as any

  return fn(messages).finally(() => {
    globalThis.Worker = OriginalWorker
  })
}

function withTerminateSpy<T>(
  fn: (terminateCount: { value: number }) => Promise<T>
): Promise<T> {
  const terminateCount = { value: 0 }
  const OriginalWorker = globalThis.Worker

  class SpyWorker extends Worker {
    constructor(specifier: string | URL, options?: WorkerOptions) {
      super(specifier, options)
      const originalTerminate = this.terminate.bind(this)
      this.terminate = () => {
        terminateCount.value++
        return originalTerminate()
      }
    }
  }

  globalThis.Worker = SpyWorker as any

  return fn(terminateCount).finally(() => {
    globalThis.Worker = OriginalWorker
  })
}

Deno.test('engine install persists plugin to storage', async () => {
  const { store, layer } = ephemeralStorage()

  const effect = Effect.gen(function* () {
    const engine = yield* Engine
    yield* engine.install(installTestPlugin)
  })

  const exit = await runEngine(Effect.scoped(effect), layer)
  assert(Exit.isSuccess(exit))

  const installedPlugins = store.get(
    PluginRegistry.CONSTANTS.InstalledPlugins
  ) as any[]

  assert(installedPlugins !== undefined)
  assertEquals(installedPlugins.length, 1)
  assertEquals(installedPlugins[0].id, 'install-test')
})

Deno.test('engine install dispatches onInstall hook', async () => {
  const { layer } = ephemeralStorage()

  const effect = Effect.gen(function* () {
    const engine = yield* Engine
    yield* engine.install(installTestPlugin)
  })

  await withPostMessageSpy(async (messages) => {
    const exit = await runEngine(Effect.scoped(effect), layer)
    assert(Exit.isSuccess(exit))

    const onInstallMessage = messages.find(
      (m: any) => m.event === PluginRegistry.CONSTANTS.OnInstall
    )
    assert(onInstallMessage !== undefined)
    assertEquals((onInstallMessage as any).payload.id, installTestPlugin.id)
  })
})

Deno.test('engine start dispatches onStart hook for pre-installed plugins', async () => {
  const { store, layer } = ephemeralStorage()
  store.set(PluginRegistry.CONSTANTS.InstalledPlugins, [installTestPlugin])

  const effect = Effect.gen(function* () {
    const engine = yield* Engine
    yield* engine.start()
  })

  await withPostMessageSpy(async (messages) => {
    const exit = await runEngine(Effect.scoped(effect), layer)
    assert(Exit.isSuccess(exit))

    const onStartMessage = messages.find(
      (m: any) => m.event === PluginRegistry.CONSTANTS.OnStart
    )
    assert(onStartMessage !== undefined)
    assertEquals((onStartMessage as any).payload.id, installTestPlugin.id)
  })
})

Deno.test('engine install interrupts the worker after onInstall', async () => {
  const { layer } = ephemeralStorage()

  const effect = Effect.gen(function* () {
    const engine = yield* Engine
    yield* engine.install(installTestPlugin)
  })

  await withTerminateSpy(async (count) => {
    const exit = await runEngine(Effect.scoped(effect), layer)
    assert(Exit.isSuccess(exit))
    assertEquals(count.value, 1)
  })
})

Deno.test('engine install throws when plugin is already installed', async () => {
  const { layer } = ephemeralStorage()

  const effect = Effect.gen(function* () {
    const engine = yield* Engine
    yield* engine.install(installTestPlugin)
    yield* engine.install(installTestPlugin)
  })

  const exit = await runEngine(Effect.scoped(effect), layer)
  assert(Exit.isFailure(exit))
})

Deno.test('engine start handles multiple pre-installed plugins', async () => {
  const { store, layer } = ephemeralStorage()
  store.set(PluginRegistry.CONSTANTS.InstalledPlugins, [
    installTestPlugin,
    installTestPlugin2,
    installTestPlugin3
  ])

  const effect = Effect.gen(function* () {
    const engine = yield* Engine
    yield* engine.start()
  })

  await withPostMessageSpy(async (messages) => {
    const exit = await runEngine(Effect.scoped(effect), layer)
    assert(Exit.isSuccess(exit))

    const onStartMessages = messages.filter(
      (m: any) => m.event === PluginRegistry.CONSTANTS.OnStart
    )
    assertEquals(onStartMessages.length, 3)
    const ids = onStartMessages.map((m: any) => m.payload.id).sort()
    assertEquals(ids, ['install-test', 'install-test-2', 'install-test-3'])
  })
})

Deno.test('engine install persists multiple different plugins', async () => {
  const { store, layer } = ephemeralStorage()

  const effect = Effect.gen(function* () {
    const engine = yield* Engine
    yield* engine.install(installTestPlugin)
    yield* engine.install(installTestPlugin2)
  })

  const exit = await runEngine(Effect.scoped(effect), layer)
  assert(Exit.isSuccess(exit))

  const installedPlugins = store.get(
    PluginRegistry.CONSTANTS.InstalledPlugins
  ) as any[]

  assertEquals(installedPlugins.length, 2)
  const ids = installedPlugins.map((p) => p.id).sort()
  assertEquals(ids, ['install-test', 'install-test-2'])
})

Deno.test('engine start succeeds with no pre-installed plugins', async () => {
  const { layer } = ephemeralStorage()

  const effect = Effect.gen(function* () {
    const engine = yield* Engine
    yield* engine.start()
  })

  const exit = await runEngine(Effect.scoped(effect), layer)
  assert(Exit.isSuccess(exit))
})
