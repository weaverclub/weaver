import { Data, Effect, Schema } from 'effect'
import { Storage } from './storage.ts'
import { PluginManifest } from './plugin.ts'
import { RuntimePermissionSchema } from './runtimePermission.ts'

const CONSTANTS = {
  'InstalledPlugins': '__weaver_installed_plugins__'
}

const parseInstalledPluginsArray = Schema.decodeUnknown(
  Schema.Array(PluginManifest.pipe(
    Schema.extend(Schema.Struct({
      givenRuntimePermissions: Schema.Array(RuntimePermissionSchema),
      givenPermissions: Schema.Array(Schema.String)
    }))
  ))
)

export class PluginRegistryError
  extends Data.TaggedError('PluginRegistryError')<{
    cause: unknown
  }> {}

export class PluginRegistry extends Effect.Service<PluginRegistry>()(
  'PluginRegistry',
  {
    effect: Effect.gen(function* () {
      const storage = yield* Storage

      function getInstalledPlugins() {
        return Effect.gen(function* () {
          const rawInstalledPlugins = yield* storage.get(
            CONSTANTS.InstalledPlugins
          )

          return yield* parseInstalledPluginsArray(rawInstalledPlugins)
        })
      }

      return {
        getInstalledPlugins
      } as const
    })
  }
) {}
