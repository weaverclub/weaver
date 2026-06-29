import { Effect, Exit, Layer } from 'effect'
import { PluginRegistry } from './pluginRegistry.ts'
import { ItemNotFoundError, Storage, StorageError } from './storage.ts'
import { PluginManifest } from './plugin.ts'
import { net } from './runtimePermission.ts'
import { assert, assertEquals } from '@std/assert'

const registryTestPlugin = {
  ...PluginManifest.make({
    id: 'registry-test',
    name: 'Registry Test Plugin',
    requestedHostPermissions: [],
    requestedRuntimePermissions: [],
    entrypoint: '../test-workers/testWorker.ts',
    supportedHostVersions: ['1.0.0'],
    version: '1.0.0'
  }),
  grantedRuntimePermissions: [],
  grantedHostPermissions: []
}

const registryTestPlugin2 = {
  ...PluginManifest.make({
    id: 'registry-test-2',
    name: 'Registry Test Plugin 2',
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

const runRegistry = <A, E>(
  effect: Effect.Effect<A, E, any>,
  storageLayer: Layer.Layer<Storage, never, never>
) =>
  Effect.runPromiseExit(
    effect.pipe(
      Effect.provide(PluginRegistry.Default),
      Effect.provide(storageLayer)
    ) as Effect.Effect<A, E, never>
  )

Deno.test('pluginRegistry getInstalledPlugins returns empty array when storage is empty', async () => {
  const { layer } = ephemeralStorage()

  const effect = Effect.gen(function* () {
    const registry = yield* PluginRegistry
    const plugins = yield* registry.getInstalledPlugins()
    assertEquals(plugins, [])
  })

  const exit = await runRegistry(effect, layer)
  assert(Exit.isSuccess(exit))
})

Deno.test('pluginRegistry installPlugin persists plugin to storage', async () => {
  const { store, layer } = ephemeralStorage()

  const effect = Effect.gen(function* () {
    const registry = yield* PluginRegistry
    yield* registry.installPlugin(registryTestPlugin)
  })

  const exit = await runRegistry(effect, layer)
  assert(Exit.isSuccess(exit))

  const installedPlugins = store.get(
    PluginRegistry.CONSTANTS.InstalledPlugins
  ) as any[]

  assert(installedPlugins !== undefined)
  assertEquals(installedPlugins.length, 1)
  assertEquals(installedPlugins[0].id, 'registry-test')
})

Deno.test('pluginRegistry installPlugin throws when plugin is already installed', async () => {
  const { layer } = ephemeralStorage()

  const effect = Effect.gen(function* () {
    const registry = yield* PluginRegistry
    yield* registry.installPlugin(registryTestPlugin)
    yield* registry.installPlugin(registryTestPlugin)
  })

  const exit = await runRegistry(effect, layer)
  assert(Exit.isFailure(exit))
})

Deno.test('pluginRegistry installPlugin allows multiple different plugins', async () => {
  const { store, layer } = ephemeralStorage()

  const effect = Effect.gen(function* () {
    const registry = yield* PluginRegistry
    yield* registry.installPlugin(registryTestPlugin)
    yield* registry.installPlugin(registryTestPlugin2)
  })

  const exit = await runRegistry(effect, layer)
  assert(Exit.isSuccess(exit))

  const installedPlugins = store.get(
    PluginRegistry.CONSTANTS.InstalledPlugins
  ) as any[]

  assertEquals(installedPlugins.length, 2)
  const ids = installedPlugins.map((p) => p.id).sort()
  assertEquals(ids, ['registry-test', 'registry-test-2'])
})

Deno.test('pluginRegistry getInstalledPlugins returns installed plugins', async () => {
  const { layer } = ephemeralStorage()

  const effect = Effect.gen(function* () {
    const registry = yield* PluginRegistry
    yield* registry.installPlugin(registryTestPlugin)
    const plugins = yield* registry.getInstalledPlugins()
    assertEquals(plugins.length, 1)
    assertEquals(plugins[0].id, 'registry-test')
  })

  const exit = await runRegistry(effect, layer)
  assert(Exit.isSuccess(exit))
})

Deno.test('pluginRegistry grantHostPermission persists app permission grants', async () => {
  const { layer } = ephemeralStorage()

  const effect = Effect.gen(function* () {
    const registry = yield* PluginRegistry
    yield* registry.installPlugin(registryTestPlugin)

    const firstGrant = yield* registry.grantHostPermission(
      registryTestPlugin.id,
      'manage-tasks'
    )
    const duplicateGrant = yield* registry.grantHostPermission(
      registryTestPlugin.id,
      'manage-tasks'
    )
    const plugins = yield* registry.getInstalledPlugins()

    assertEquals(firstGrant.changed, true)
    assertEquals(duplicateGrant.changed, false)
    assertEquals(plugins[0].grantedHostPermissions, ['manage-tasks'])
  })

  const exit = await runRegistry(effect, layer)
  assert(Exit.isSuccess(exit))
})

Deno.test('pluginRegistry revokeHostPermission persists app permission revokes', async () => {
  const { layer } = ephemeralStorage()

  const effect = Effect.gen(function* () {
    const registry = yield* PluginRegistry
    yield* registry.installPlugin({
      ...registryTestPlugin,
      grantedHostPermissions: ['manage-tasks', 'delete-tasks']
    })

    const firstRevoke = yield* registry.revokeHostPermission(
      registryTestPlugin.id,
      'delete-tasks'
    )
    const duplicateRevoke = yield* registry.revokeHostPermission(
      registryTestPlugin.id,
      'delete-tasks'
    )
    const plugins = yield* registry.getInstalledPlugins()

    assertEquals(firstRevoke.changed, true)
    assertEquals(duplicateRevoke.changed, false)
    assertEquals(plugins[0].grantedHostPermissions, ['manage-tasks'])
  })

  const exit = await runRegistry(effect, layer)
  assert(Exit.isSuccess(exit))
})

Deno.test('pluginRegistry grantRuntimePermission persists Deno permission grants', async () => {
  const { layer } = ephemeralStorage()
  const apiPermission = net(['api.example.com'])

  const effect = Effect.gen(function* () {
    const registry = yield* PluginRegistry
    yield* registry.installPlugin(registryTestPlugin)

    const firstGrant = yield* registry.grantRuntimePermission(
      registryTestPlugin.id,
      apiPermission
    )
    const duplicateGrant = yield* registry.grantRuntimePermission(
      registryTestPlugin.id,
      net(['api.example.com'])
    )
    const plugins = yield* registry.getInstalledPlugins()

    assertEquals(firstGrant.changed, true)
    assertEquals(duplicateGrant.changed, false)
    assertEquals(plugins[0].grantedRuntimePermissions, [apiPermission])
  })

  const exit = await runRegistry(effect, layer)
  assert(Exit.isSuccess(exit))
})

Deno.test('pluginRegistry revokeRuntimePermission persists Deno permission revokes', async () => {
  const { layer } = ephemeralStorage()
  const apiPermission = net(['api.example.com'])
  const cdnPermission = net(['cdn.example.com'])

  const effect = Effect.gen(function* () {
    const registry = yield* PluginRegistry
    yield* registry.installPlugin({
      ...registryTestPlugin,
      grantedRuntimePermissions: [apiPermission, cdnPermission]
    })

    const firstRevoke = yield* registry.revokeRuntimePermission(
      registryTestPlugin.id,
      apiPermission
    )
    const duplicateRevoke = yield* registry.revokeRuntimePermission(
      registryTestPlugin.id,
      apiPermission
    )
    const plugins = yield* registry.getInstalledPlugins()

    assertEquals(firstRevoke.changed, true)
    assertEquals(duplicateRevoke.changed, false)
    assertEquals(plugins[0].grantedRuntimePermissions, [cdnPermission])
  })

  const exit = await runRegistry(effect, layer)
  assert(Exit.isSuccess(exit))
})

Deno.test('pluginRegistry disablePlugin and enablePlugin persist disabled plugin ids', async () => {
  const { store, layer } = ephemeralStorage()

  const effect = Effect.gen(function* () {
    const registry = yield* PluginRegistry
    yield* registry.installPlugin(registryTestPlugin)

    const disable = yield* registry.disablePlugin(registryTestPlugin.id)
    const duplicateDisable = yield* registry.disablePlugin(
      registryTestPlugin.id
    )
    const enable = yield* registry.enablePlugin(registryTestPlugin.id)
    const duplicateEnable = yield* registry.enablePlugin(registryTestPlugin.id)

    assertEquals(disable.changed, true)
    assertEquals(duplicateDisable.changed, false)
    assertEquals(enable.changed, true)
    assertEquals(duplicateEnable.changed, false)
  })

  const exit = await runRegistry(effect, layer)
  assert(Exit.isSuccess(exit))

  assertEquals(store.get(PluginRegistry.CONSTANTS.DisabledPlugins), [])
})

Deno.test('pluginRegistry uninstallPlugin removes plugin and disabled state', async () => {
  const { store, layer } = ephemeralStorage()

  const effect = Effect.gen(function* () {
    const registry = yield* PluginRegistry
    yield* registry.installPlugin(registryTestPlugin)
    yield* registry.disablePlugin(registryTestPlugin.id)

    const result = yield* registry.uninstallPlugin(registryTestPlugin.id)

    assertEquals(result.plugin.id, registryTestPlugin.id)
    assertEquals(result.changed, true)
  })

  const exit = await runRegistry(effect, layer)
  assert(Exit.isSuccess(exit))

  assertEquals(store.get(PluginRegistry.CONSTANTS.InstalledPlugins), [])
  assertEquals(store.get(PluginRegistry.CONSTANTS.DisabledPlugins), [])
})

Deno.test('pluginRegistry updatePlugin replaces installed plugin metadata', async () => {
  const { layer } = ephemeralStorage()
  const updatedPlugin = {
    ...registryTestPlugin,
    name: 'Updated Registry Test Plugin',
    version: '2.0.0'
  }

  const effect = Effect.gen(function* () {
    const registry = yield* PluginRegistry
    yield* registry.installPlugin(registryTestPlugin)

    const result = yield* registry.updatePlugin(updatedPlugin)
    const duplicateUpdate = yield* registry.updatePlugin(updatedPlugin)
    const plugins = yield* registry.getInstalledPlugins()

    assertEquals(result.changed, true)
    assertEquals(result.previousPlugin.version, '1.0.0')
    assertEquals(result.plugin.version, '2.0.0')
    assertEquals(duplicateUpdate.changed, false)
    assertEquals(plugins[0].name, 'Updated Registry Test Plugin')
  })

  const exit = await runRegistry(effect, layer)
  assert(Exit.isSuccess(exit))
})

Deno.test('pluginRegistry getInstalledPlugins fails with corrupted storage data', async () => {
  const { store, layer } = ephemeralStorage()
  store.set(PluginRegistry.CONSTANTS.InstalledPlugins, 'invalid-data')

  const effect = Effect.gen(function* () {
    const registry = yield* PluginRegistry
    yield* registry.getInstalledPlugins()
  })

  const exit = await runRegistry(effect, layer)
  assert(Exit.isFailure(exit))
})
