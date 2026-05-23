import { Data, Effect, Schema } from 'effect'
import { Storage } from './storage.ts'
import { PluginManifest } from './plugin.ts'

const CONSTANTS = {
  'InstalledPlugins': '__weaver_installed_plugins__'
}

const parsePluginManifestArray = Schema.decodeUnknown(
  Schema.Array(PluginManifest)
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

          return yield* parsePluginManifestArray(rawInstalledPlugins)
        })
      }

      return {
        getInstalledPlugins
      } as const
    })
  }
) {}
