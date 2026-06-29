import { Effect, Exit, Layer, PubSub, Queue, Schema } from 'effect'
import {
  Engine,
  engine as createEngine,
  ephemeralStorage as createEphemeralStorage,
  HostDefinition
} from './engine.ts'
import { Supervisor } from './supervisor.ts'
import { PluginRegistry } from './pluginRegistry.ts'
import { ItemNotFoundError, Storage, StorageError } from './storage.ts'
import { PluginManifest } from './plugin.ts'
import { ProtocolEvent, type WorkerMessage } from './protocol.ts'
import { net } from './runtimePermission.ts'
import { assert, assertEquals } from '@std/assert'
import { LoggerLayer, MinimumLogLevelLayer } from './log.ts'
import { host } from './host.ts'
import { event } from './event.ts'
import { permission } from './permission.ts'
import { postExecution } from './hook.ts'
import { rpc } from './rpc.ts'

const testHost = host({
  name: 'Test Host',
  version: '1.0.0',
  rpc: {},
  permissions: []
})

const installTestPlugin = {
  ...PluginManifest.make({
    id: 'install-test',
    name: 'Install Test Plugin',
    requestedHostPermissions: [],
    requestedRuntimePermissions: [],
    entrypoint: '../test-workers/testNoopRuntimePluginWorker.ts',
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
    entrypoint: '../test-workers/testNoopRuntimePluginWorker.ts',
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
    entrypoint: '../test-workers/testNoopRuntimePluginWorker.ts',
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
      Effect.provide(Layer.succeed(HostDefinition, testHost)),
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

function hookDispatchMessages(
  messages: unknown[],
  event: string
) {
  return messages.filter((m: any) =>
    m.event === ProtocolEvent.HookDispatch && m.payload.event === event
  )
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

    const onInstallMessage = hookDispatchMessages(
      messages,
      PluginRegistry.CONSTANTS.OnInstall
    )[0]
    assert(onInstallMessage !== undefined)
    assertEquals(
      (onInstallMessage as any).payload.payload.id,
      installTestPlugin.id
    )
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

    const onStartMessage = hookDispatchMessages(
      messages,
      PluginRegistry.CONSTANTS.OnStart
    )[0]
    assert(onStartMessage !== undefined)
    assertEquals(
      (onStartMessage as any).payload.payload.id,
      installTestPlugin.id
    )
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

Deno.test('engine install fails when onInstall hook fails and still interrupts worker', async () => {
  const { store, layer } = ephemeralStorage()

  const failingInstallPlugin = {
    ...PluginManifest.make({
      id: 'failing-install',
      name: 'Failing Install Plugin',
      requestedHostPermissions: [],
      requestedRuntimePermissions: [],
      entrypoint: '../test-workers/testFailingInstallPluginWorker.ts',
      supportedHostVersions: ['1.0.0'],
      version: '1.0.0'
    }),
    grantedRuntimePermissions: [],
    grantedHostPermissions: []
  }

  const effect = Effect.gen(function* () {
    const engine = yield* Engine
    yield* engine.install(failingInstallPlugin)
  })

  await withTerminateSpy(async (count) => {
    const exit = await runEngine(Effect.scoped(effect), layer)
    assert(Exit.isFailure(exit))
    assertEquals(count.value, 1)
  })

  assertEquals(store.get(PluginRegistry.CONSTANTS.InstalledPlugins), [])
})

Deno.test('engine install times out when plugin runtime never becomes ready', async () => {
  const { layer } = ephemeralStorage()

  const noRuntimePlugin = {
    ...PluginManifest.make({
      id: 'no-runtime',
      name: 'No Runtime Plugin',
      requestedHostPermissions: [],
      requestedRuntimePermissions: [],
      entrypoint: '../test-workers/testWorker.ts',
      supportedHostVersions: ['1.0.0'],
      version: '1.0.0'
    }),
    grantedRuntimePermissions: [],
    grantedHostPermissions: []
  }

  const effect = Effect.gen(function* () {
    const engine = yield* Engine
    yield* engine.install(noRuntimePlugin)
  })

  await withTerminateSpy(async (count) => {
    const exit = await runEngine(Effect.scoped(effect), layer)
    assert(Exit.isFailure(exit))
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

    const onStartMessages = hookDispatchMessages(
      messages,
      PluginRegistry.CONSTANTS.OnStart
    )
    assertEquals(onStartMessages.length, 3)
    const ids = onStartMessages.map((m: any) => m.payload.payload.id).sort()
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

    const onStartMessage = hookDispatchMessages(
      messages,
      PluginRegistry.CONSTANTS.OnStart
    )[0]
    assert(onStartMessage !== undefined)
    assertEquals(
      (onStartMessage as any).payload.payload.id,
      installTestPlugin.id
    )
  })
})

Deno.test('engine start dispatches onStart for plugins installed after engine initialization', async () => {
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

    const onStartMessages = hookDispatchMessages(
      messages,
      PluginRegistry.CONSTANTS.OnStart
    )
    assertEquals(onStartMessages.length, 2)
    const ids = onStartMessages.map((m: any) => m.payload.payload.id).sort()
    assertEquals(ids, ['install-test', 'install-test-2'])
  })
})

Deno.test('engine start then install dispatches onInstall and starts the new plugin', async () => {
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

    const onStartMessages = hookDispatchMessages(
      messages,
      PluginRegistry.CONSTANTS.OnStart
    )
    assertEquals(onStartMessages.length, 2)
    const onStartIds = onStartMessages.map((m: any) => m.payload.payload.id)
      .sort()
    assertEquals(onStartIds, ['install-test', 'install-test-2'])

    const onInstallMessages = hookDispatchMessages(
      messages,
      PluginRegistry.CONSTANTS.OnInstall
    )
    assertEquals(onInstallMessages.length, 1)
    assertEquals(
      (onInstallMessages[0] as any).payload.payload.id,
      installTestPlugin2.id
    )
  })
})

Deno.test('engine start skips disabled plugins and reports disabled status', async () => {
  const { store, layer } = ephemeralStorage()
  store.set(PluginRegistry.CONSTANTS.InstalledPlugins, [
    installTestPlugin,
    installTestPlugin2
  ])
  store.set(PluginRegistry.CONSTANTS.DisabledPlugins, [installTestPlugin2.id])

  const effect = Effect.gen(function* () {
    const engine = yield* Engine
    yield* engine.start()

    const disabledStatus = yield* engine.getPluginStatus(
      installTestPlugin2.id
    )
    assertEquals(disabledStatus.state, 'disabled')
  })

  await withPostMessageSpy(async (messages) => {
    const exit = await runEngine(Effect.scoped(effect), layer)
    assert(Exit.isSuccess(exit))

    const onStartMessages = hookDispatchMessages(
      messages,
      PluginRegistry.CONSTANTS.OnStart
    )
    assertEquals(onStartMessages.length, 1)
    assertEquals(
      (onStartMessages[0] as any).payload.payload.id,
      installTestPlugin.id
    )
  })
})

Deno.test('engine disablePlugin persists disabled status and stops running worker', async () => {
  const { store, layer } = ephemeralStorage()
  store.set(PluginRegistry.CONSTANTS.InstalledPlugins, [installTestPlugin])

  const effect = Effect.gen(function* () {
    const engine = yield* Engine
    yield* engine.start()

    const result = yield* engine.disablePlugin(installTestPlugin.id)
    const status = yield* engine.getPluginStatus(installTestPlugin.id)
    const handle = yield* engine.supervisor.getByPluginId(installTestPlugin.id)

    assertEquals(result.changed, true)
    assertEquals(result.stopped, true)
    assertEquals(status.state, 'disabled')
    assert(handle._tag === 'None')
  })

  await withTerminateSpy(async (count) => {
    const exit = await runEngine(Effect.scoped(effect), layer)
    assert(Exit.isSuccess(exit))
    assertEquals(count.value, 1)
  })

  assertEquals(store.get(PluginRegistry.CONSTANTS.DisabledPlugins), [
    installTestPlugin.id
  ])
})

Deno.test('engine enablePlugin starts disabled plugin when engine is running', async () => {
  const { store, layer } = ephemeralStorage()
  store.set(PluginRegistry.CONSTANTS.InstalledPlugins, [installTestPlugin])
  store.set(PluginRegistry.CONSTANTS.DisabledPlugins, [installTestPlugin.id])

  const effect = Effect.gen(function* () {
    const engine = yield* Engine
    yield* engine.start()

    const result = yield* engine.enablePlugin(installTestPlugin.id)
    const status = yield* engine.getPluginStatus(installTestPlugin.id)

    assertEquals(result.changed, true)
    assertEquals(result.started, true)
    assertEquals(status.state, 'running')
  })

  await withPostMessageSpy(async (messages) => {
    const exit = await runEngine(Effect.scoped(effect), layer)
    assert(Exit.isSuccess(exit))

    const onStartMessages = hookDispatchMessages(
      messages,
      PluginRegistry.CONSTANTS.OnStart
    )
    assertEquals(onStartMessages.length, 1)
    assertEquals(
      (onStartMessages[0] as any).payload.payload.id,
      installTestPlugin.id
    )
  })

  assertEquals(store.get(PluginRegistry.CONSTANTS.DisabledPlugins), [])
})

Deno.test('engine uninstallPlugin removes plugin and stops running worker', async () => {
  const { store, layer } = ephemeralStorage()
  store.set(PluginRegistry.CONSTANTS.InstalledPlugins, [installTestPlugin])

  const effect = Effect.gen(function* () {
    const engine = yield* Engine
    yield* engine.start()

    const result = yield* engine.uninstallPlugin(installTestPlugin.id)
    const plugins = yield* engine.pluginRegistry.getInstalledPlugins()
    const handle = yield* engine.supervisor.getByPluginId(installTestPlugin.id)

    assertEquals(result.plugin.id, installTestPlugin.id)
    assertEquals(result.stopped, true)
    assertEquals(plugins, [])
    assert(handle._tag === 'None')
  })

  await withTerminateSpy(async (count) => {
    const exit = await runEngine(Effect.scoped(effect), layer)
    assert(Exit.isSuccess(exit))
    assertEquals(count.value, 1)
  })

  assertEquals(store.get(PluginRegistry.CONSTANTS.InstalledPlugins), [])
})

Deno.test('engine updatePlugin restarts running plugin with updated metadata', async () => {
  const { store, layer } = ephemeralStorage()
  const updatedPlugin = {
    ...installTestPlugin,
    name: 'Updated Install Test Plugin',
    version: '2.0.0'
  }
  store.set(PluginRegistry.CONSTANTS.InstalledPlugins, [installTestPlugin])

  const effect = Effect.gen(function* () {
    const engine = yield* Engine
    yield* engine.start()

    const firstHandle = yield* engine.supervisor.getByPluginId(
      installTestPlugin.id
    )
    assert(firstHandle._tag === 'Some')

    const result = yield* engine.updatePlugin(updatedPlugin)
    const secondHandle = yield* engine.supervisor.getByPluginId(
      installTestPlugin.id
    )
    const status = yield* engine.getPluginStatus(installTestPlugin.id)
    const plugins = yield* engine.pluginRegistry.getInstalledPlugins()

    assert(secondHandle._tag === 'Some')
    assertEquals(result.changed, true)
    assertEquals(result.restarted, true)
    assertEquals(result.previousPlugin.version, '1.0.0')
    assertEquals(result.plugin.version, '2.0.0')
    assert(secondHandle.value.id !== firstHandle.value.id)
    assertEquals(status.state, 'running')
    assertEquals(plugins[0].version, '2.0.0')

    yield* engine.supervisor.interrupt(secondHandle.value.id)
  })

  await withTerminateSpy(async (count) => {
    const exit = await runEngine(Effect.scoped(effect), layer)
    assert(Exit.isSuccess(exit))
    assertEquals(count.value, 2)
  })
})

Deno.test('engine grantHostPermission updates app grants without restarting worker', async () => {
  const { store, layer } = ephemeralStorage()
  store.set(PluginRegistry.CONSTANTS.InstalledPlugins, [installTestPlugin])

  const effect = Effect.gen(function* () {
    const engine = yield* Engine
    yield* engine.start()

    const firstHandle = yield* engine.supervisor.getByPluginId(
      installTestPlugin.id
    )
    assert(firstHandle._tag === 'Some')

    const result = yield* engine.grantHostPermission(
      installTestPlugin.id,
      'manage-tasks'
    )

    const secondHandle = yield* engine.supervisor.getByPluginId(
      installTestPlugin.id
    )
    const plugins = yield* engine.pluginRegistry.getInstalledPlugins()

    assert(secondHandle._tag === 'Some')
    assertEquals(result.changed, true)
    assertEquals(secondHandle.value.id, firstHandle.value.id)
    assertEquals(plugins[0].grantedHostPermissions, ['manage-tasks'])

    yield* engine.supervisor.interrupt(secondHandle.value.id)
  })

  await withTerminateSpy(async (count) => {
    const exit = await runEngine(Effect.scoped(effect), layer)
    assert(Exit.isSuccess(exit))
    assertEquals(count.value, 1)
  })
})

Deno.test('engine grantRuntimePermission restarts running worker', async () => {
  const { store, layer } = ephemeralStorage()
  const apiPermission = net(['api.example.com'])
  store.set(PluginRegistry.CONSTANTS.InstalledPlugins, [installTestPlugin])

  const effect = Effect.gen(function* () {
    const engine = yield* Engine
    yield* engine.start()

    const firstHandle = yield* engine.supervisor.getByPluginId(
      installTestPlugin.id
    )
    assert(firstHandle._tag === 'Some')

    const result = yield* engine.grantRuntimePermission(
      installTestPlugin.id,
      apiPermission
    )

    const secondHandle = yield* engine.supervisor.getByPluginId(
      installTestPlugin.id
    )
    const plugins = yield* engine.pluginRegistry.getInstalledPlugins()

    assert(secondHandle._tag === 'Some')
    assertEquals(result.changed, true)
    assertEquals(result.restarted, true)
    assert(secondHandle.value.id !== firstHandle.value.id)
    assertEquals(plugins[0].grantedRuntimePermissions, [apiPermission])

    yield* engine.supervisor.interrupt(secondHandle.value.id)
  })

  await withTerminateSpy(async (count) => {
    const exit = await runEngine(Effect.scoped(effect), layer)
    assert(Exit.isSuccess(exit))
    assertEquals(count.value, 2)
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

Deno.test('engine start times out when installed plugin runtime never becomes ready', async () => {
  const { store, layer } = ephemeralStorage()

  store.set(PluginRegistry.CONSTANTS.InstalledPlugins, [{
    ...PluginManifest.make({
      id: 'no-runtime-start',
      name: 'No Runtime Start Plugin',
      requestedHostPermissions: [],
      requestedRuntimePermissions: [],
      entrypoint: '../test-workers/testWorker.ts',
      supportedHostVersions: ['1.0.0'],
      version: '1.0.0'
    }),
    grantedRuntimePermissions: [],
    grantedHostPermissions: []
  }])

  const effect = Effect.gen(function* () {
    const engine = yield* Engine
    yield* engine.start()
  })

  const exit = await runEngine(Effect.scoped(effect), layer)
  assert(Exit.isFailure(exit))
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

Deno.test('engine runs metadata-installed plugin that handles host event and calls host RPC', async () => {
  const manageTasks = permission({
    key: 'manage-tasks',
    description: 'Manage tasks'
  })

  const taskSchema = Schema.standardSchemaV1(
    Schema.Struct({
      taskId: Schema.String,
      title: Schema.String,
      completed: Schema.Boolean
    })
  )

  const afterCreateTask = event({
    key: 'afterCreateTask',
    payload: taskSchema,
    description: 'Emitted after a task is created'
  })

  const getTaskCalls: string[] = []

  const getTask = rpc({
    input: Schema.standardSchemaV1(
      Schema.Struct({
        taskId: Schema.String
      })
    ),
    output: taskSchema,
    handler: ({ taskId }) => {
      getTaskCalls.push(taskId)

      return {
        taskId,
        title: 'Observed Task',
        completed: false
      }
    },
    requiredPermissions: [manageTasks]
  })

  const createTask = rpc({
    input: Schema.standardSchemaV1(
      Schema.Struct({
        title: Schema.String
      })
    ),
    output: taskSchema,
    handler: ({ title }) => ({
      taskId: 'task-1',
      title,
      completed: false
    }),
    hooks: [
      postExecution((ctx) => {
        ctx.emit(afterCreateTask, ctx.output)
      })
    ],
    requiredPermissions: [manageTasks]
  })

  const taskHost = host({
    name: 'Task Host',
    version: '1.0.0',
    rpc: {
      getTask,
      createTask
    },
    permissions: [manageTasks]
  })

  const myEngine = createEngine({
    host: taskHost,
    storage: createEphemeralStorage()
  })

  try {
    await myEngine.install({
      ...PluginManifest.make({
        id: 'runtime-plugin',
        name: 'Runtime Plugin',
        requestedHostPermissions: ['manage-tasks'],
        requestedRuntimePermissions: [],
        entrypoint: '../test-workers/testRuntimePluginWorker.ts',
        supportedHostVersions: ['1.x'],
        version: '1.0.0'
      }),
      grantedHostPermissions: ['manage-tasks'],
      grantedRuntimePermissions: []
    })

    await myEngine.start()
    await myEngine.rpc.createTask({ title: 'Write tests' })

    await waitFor(() => getTaskCalls.includes('task-1'))
  } finally {
    await myEngine.stop()
  }
})

async function waitFor(
  predicate: () => boolean,
  timeout = 1_000
) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeout) {
    if (predicate()) {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  assert(predicate())
}
