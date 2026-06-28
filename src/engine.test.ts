import { Effect, Exit, Layer, PubSub, Queue } from 'effect'
import { Engine } from './engine.ts'
import { Supervisor } from './supervisor.ts'
import { PluginRegistry } from './pluginRegistry.ts'
import { ItemNotFoundError, Storage, StorageError } from './storage.ts'
import { PluginManifest } from './plugin.ts'
import type { WorkerMessage } from './protocol.ts'
import { assert, assertEquals } from '@std/assert'
import { LoggerLayer, MinimumLogLevelLayer } from './log.ts'

const installTestPlugin = {
  ...PluginManifest.make({
    id: 'install-test',
    name: 'Install Test Plugin',
    requestedHostPermissions: [],
    requestedRuntimePermissions: [],
    entrypoint: '../test-workers/testWorker.ts',
    supportedHostVersions: ['1.0.0'],
    version: '1.0.0'
  }),
  grantedRuntimePermissions: [],
  grantedHostPermissions: []
}

const installTestPlugin2 = {
  ...PluginManifest.make({
    id: 'install-test-2',
    name: 'Install Test Plugin 2',
    requestedHostPermissions: [],
    requestedRuntimePermissions: [],
    entrypoint: '../test-workers/testWorker.ts',
    supportedHostVersions: ['1.0.0'],
    version: '1.0.0'
  }),
  grantedRuntimePermissions: [],
  grantedHostPermissions: []
}

const installTestPlugin3 = {
  ...PluginManifest.make({
    id: 'install-test-3',
    name: 'Install Test Plugin 3',
    requestedHostPermissions: [],
    requestedRuntimePermissions: [],
    entrypoint: '../test-workers/testWorker.ts',
    supportedHostVersions: ['1.0.0'],
    version: '1.0.0'
  }),
  grantedRuntimePermissions: [],
  grantedHostPermissions: []
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

const messagePlugin = PluginManifest.make({
  id: 'message',
  name: 'Message Plugin',
  requestedHostPermissions: [],
  requestedRuntimePermissions: [],
  entrypoint: '../test-workers/testMessageWorker.ts',
  supportedHostVersions: ['1.0.0'],
  version: '1.0.0'
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

Deno.test('engine install then start on fresh engine dispatches onStart for installed plugin', async () => {
  const { layer } = ephemeralStorage()

  const installEffect = Effect.gen(function* () {
    const engine = yield* Engine
    yield* engine.install(installTestPlugin)
  })

  const installExit = await runEngine(Effect.scoped(installEffect), layer)
  assert(Exit.isSuccess(installExit))

  const startEffect = Effect.gen(function* () {
    const engine = yield* Engine
    yield* engine.start()
  })

  await withPostMessageSpy(async (messages) => {
    const startExit = await runEngine(Effect.scoped(startEffect), layer)
    assert(Exit.isSuccess(startExit))

    const onStartMessage = messages.find(
      (m: any) => m.event === PluginRegistry.CONSTANTS.OnStart
    )
    assert(onStartMessage !== undefined)
    assertEquals((onStartMessage as any).payload.id, installTestPlugin.id)
  })
})

Deno.test('engine start does not dispatch onStart for plugins installed after engine initialization', async () => {
  const { store, layer } = ephemeralStorage()
  store.set(PluginRegistry.CONSTANTS.InstalledPlugins, [installTestPlugin])

  const effect = Effect.gen(function* () {
    const engine = yield* Engine
    yield* engine.install(installTestPlugin2)
    yield* engine.start()
  })

  await withPostMessageSpy(async (messages) => {
    const exit = await runEngine(Effect.scoped(effect), layer)
    assert(Exit.isSuccess(exit))

    const onStartMessages = messages.filter(
      (m: any) => m.event === PluginRegistry.CONSTANTS.OnStart
    )
    assertEquals(onStartMessages.length, 1)
    assertEquals((onStartMessages[0] as any).payload.id, installTestPlugin.id)
  })
})

Deno.test('engine start then install dispatches onStart and onInstall', async () => {
  const { store, layer } = ephemeralStorage()
  store.set(PluginRegistry.CONSTANTS.InstalledPlugins, [installTestPlugin])

  const effect = Effect.gen(function* () {
    const engine = yield* Engine
    yield* engine.start()
    yield* engine.install(installTestPlugin2)
  })

  await withPostMessageSpy(async (messages) => {
    const exit = await runEngine(Effect.scoped(effect), layer)
    assert(Exit.isSuccess(exit))

    const onStartMessages = messages.filter(
      (m: any) => m.event === PluginRegistry.CONSTANTS.OnStart
    )
    assertEquals(onStartMessages.length, 1)
    assertEquals((onStartMessages[0] as any).payload.id, installTestPlugin.id)

    const onInstallMessages = messages.filter(
      (m: any) => m.event === PluginRegistry.CONSTANTS.OnInstall
    )
    assertEquals(onInstallMessages.length, 1)
    assertEquals(
      (onInstallMessages[0] as any).payload.id,
      installTestPlugin2.id
    )
  })
})

Deno.test('engine install duplicate leaves original plugin untouched', async () => {
  const { store, layer } = ephemeralStorage()
  store.set(PluginRegistry.CONSTANTS.InstalledPlugins, [installTestPlugin])

  const effect = Effect.gen(function* () {
    const engine = yield* Engine
    yield* engine.install(installTestPlugin)
  })

  const exit = await runEngine(Effect.scoped(effect), layer)
  assert(Exit.isFailure(exit))

  const installedPlugins = store.get(
    PluginRegistry.CONSTANTS.InstalledPlugins
  ) as any[]

  assertEquals(installedPlugins.length, 1)
  assertEquals(installedPlugins[0].id, 'install-test')
})

Deno.test('engine start fails with corrupted storage data', async () => {
  const { store, layer } = ephemeralStorage()
  store.set(PluginRegistry.CONSTANTS.InstalledPlugins, 'invalid-data')

  const effect = Effect.gen(function* () {
    const engine = yield* Engine
    yield* engine.start()
  })

  const exit = await runEngine(Effect.scoped(effect), layer)
  assert(Exit.isFailure(exit))
})

Deno.test('engine start succeeds when storage key is missing', async () => {
  const { layer } = ephemeralStorage()

  const effect = Effect.gen(function* () {
    const engine = yield* Engine
    yield* engine.start()
  })

  const exit = await runEngine(Effect.scoped(effect), layer)
  assert(Exit.isSuccess(exit))
})

Deno.test('engine supervisor routes worker messages through PubSub', async () => {
  const { layer } = ephemeralStorage()

  const effect = Effect.gen(function* () {
    const engine = yield* Engine
    const workerMessages = yield* PubSub.unbounded<WorkerMessage>()
    const workerLifecycleEvents = yield* PubSub.unbounded<any>()
    const subscription = yield* PubSub.subscribe(workerMessages)

    const { id } = yield* engine.supervisor.start({
      grantedRuntimePermissions: [],
      pluginManifest: messagePlugin,
      workerMessages,
      workerLifecycleEvents
    })

    const msg = yield* Queue.take(subscription).pipe(
      Effect.timeout('5 seconds')
    )

    assertEquals(msg.message.event, 'test.message')
    assertEquals(msg.message.payload, { value: 42 })

    yield* engine.supervisor.interrupt(id)
  })

  const exit = await runEngine(Effect.scoped(effect), layer)
  assert(Exit.isSuccess(exit))
})
