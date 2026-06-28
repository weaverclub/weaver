import { assertEquals } from '@std/assert'
import { InstalledPlugin, PluginMetadata } from './plugin.ts'

Deno.test('PluginMetadata describes a serializable worker plugin', () => {
  const metadata = PluginMetadata.make({
    id: 'metadata-test',
    name: 'Metadata Test Plugin',
    version: '1.0.0',
    supportedHostVersions: ['1.x'],
    entrypoint: 'https://plugins.example.com/metadata-test/mod.ts',
    requestedHostPermissions: ['manage-tasks'],
    requestedRuntimePermissions: [
      { type: 'net', urls: ['api.example.com'] }
    ]
  })

  assertEquals(metadata.id, 'metadata-test')
  assertEquals(
    metadata.entrypoint,
    'https://plugins.example.com/metadata-test/mod.ts'
  )
  assertEquals(metadata.requestedHostPermissions, ['manage-tasks'])
  assertEquals(metadata.requestedRuntimePermissions, [
    { type: 'net', urls: ['api.example.com'] }
  ])
})

Deno.test('InstalledPlugin keeps granted permissions separate from requested permissions', () => {
  const installedPlugin = InstalledPlugin.make({
    id: 'installed-test',
    name: 'Installed Test Plugin',
    version: '1.0.0',
    supportedHostVersions: ['1.x'],
    entrypoint: 'https://plugins.example.com/installed-test/mod.ts',
    requestedHostPermissions: ['manage-tasks', 'delete-tasks'],
    requestedRuntimePermissions: [
      { type: 'net', urls: ['api.example.com'] },
      { type: 'env', variables: ['PLUGIN_TOKEN'] }
    ],
    grantedHostPermissions: ['manage-tasks'],
    grantedRuntimePermissions: [
      { type: 'net', urls: ['api.example.com'] }
    ]
  })

  assertEquals(installedPlugin.requestedHostPermissions, [
    'manage-tasks',
    'delete-tasks'
  ])
  assertEquals(installedPlugin.grantedHostPermissions, ['manage-tasks'])
  assertEquals(installedPlugin.grantedRuntimePermissions, [
    { type: 'net', urls: ['api.example.com'] }
  ])
})
