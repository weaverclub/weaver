import { Effect, Exit, Layer } from 'effect'
import { PluginRegistry } from './pluginRegistry.ts'
import { ItemNotFoundError, Storage, StorageError } from './storage.ts'
import { PluginManifest } from './plugin.ts'
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
