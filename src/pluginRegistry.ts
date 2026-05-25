import { Data, Effect, Schema } from 'effect'
import { Storage } from './storage.ts'
import { PluginManifest } from './plugin.ts'
import { RuntimePermissionSchema } from './runtimePermission.ts'

const CONSTANTS = {
  'InstalledPlugins': '__weaver_installed_plugins__',
  'OnInstall': '__weaver_lifecycle_on_install__',
  'OnStart': '__weaver_lifecycle_on_start__'
}

const installedPlugin = PluginManifest.pipe(
  Schema.extend(Schema.Struct({
    givenRuntimePermissions: Schema.Array(RuntimePermissionSchema),
    givenPermissions: Schema.Array(Schema.String)
  }))
)

const parseInstalledPluginsArray = Schema.decodeUnknown(
  Schema.Array(installedPlugin)
)

export class PluginAlreadyInstalledError
  extends Data.TaggedError('PluginAlreadyInstalledError')<{
    pluginId: string
  }> {}

export class PluginRegistry extends Effect.Service<PluginRegistry>()(
  'PluginRegistry',
  {
    effect: Effect.gen(function* () {
      const storage = yield* Storage

      function initializeInstalledPlugins() {
        return Effect.gen(function* () {
          yield* storage.set(CONSTANTS.InstalledPlugins, [])
        })
      }

      function getInstalledPlugins() {
        return Effect.gen(function* () {
          const rawInstalledPlugins = yield* storage.get(
            CONSTANTS.InstalledPlugins
          )

          return yield* parseInstalledPluginsArray(rawInstalledPlugins)
        }).pipe(
          Effect.catchTag(
            'ItemNotFoundError',
            () =>
              initializeInstalledPlugins().pipe(
                Effect.andThen(() => [] as InstallPlugin[])
              )
          )
        )
      }

      function installPlugin(plugin: InstallPlugin) {
        return Effect.gen(function* () {
          const installedPlugins = yield* getInstalledPlugins()

          const pluginIndex = installedPlugins.find((p) => p.id === plugin.id)

          if (pluginIndex !== undefined) {
            return yield* new PluginAlreadyInstalledError({
              pluginId: plugin.id
            })
          }

          const rawNewInstalledPlugins = [...installedPlugins, plugin]

          const parsedNewInstalledPlugins = yield* parseInstalledPluginsArray(
            rawNewInstalledPlugins
          )

          yield* storage.set(
            CONSTANTS.InstalledPlugins,
            parsedNewInstalledPlugins
          )
        })
      }

      return {
        getInstalledPlugins,
        installPlugin
      } as const
    })
  }
) {
  static CONSTANTS = CONSTANTS
}

export type InstallPlugin = typeof installedPlugin.Type
