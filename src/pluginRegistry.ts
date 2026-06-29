import { Data, Effect, Schema } from 'effect'
import { Storage } from './storage.ts'
import { InstalledPlugin, type InstallPlugin } from './plugin.ts'
import { type Permission, permissionKey } from './permission.ts'
import {
  type RuntimePermission,
  runtimePermissionKey
} from './runtimePermission.ts'
import { LifecycleEvent } from './protocol.ts'

const CONSTANTS = {
  'InstalledPlugins': '__weaver_installed_plugins__',
  'OnInstall': LifecycleEvent.OnInstall,
  'OnStart': LifecycleEvent.OnStart
}

const parseInstalledPluginsArray = Schema.decodeUnknown(
  Schema.Array(InstalledPlugin)
)

export class PluginAlreadyInstalledError
  extends Data.TaggedError('PluginAlreadyInstalledError')<{
    pluginId: string
  }> {}

export class PluginNotInstalledError
  extends Data.TaggedError('PluginNotInstalledError')<{
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

      function getInstalledPlugin(pluginId: string) {
        return Effect.gen(function* () {
          const installedPlugins = yield* getInstalledPlugins()
          const plugin = installedPlugins.find((p) => p.id === pluginId)

          if (plugin === undefined) {
            return yield* new PluginNotInstalledError({
              pluginId
            })
          }

          return plugin
        })
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

      function updateInstalledPlugin(
        pluginId: string,
        update: (plugin: InstallPlugin) => PluginPermissionUpdate
      ) {
        return Effect.gen(function* () {
          const installedPlugins = yield* getInstalledPlugins()
          const pluginIndex = installedPlugins.findIndex(
            (p) => p.id === pluginId
          )

          if (pluginIndex === -1) {
            return yield* new PluginNotInstalledError({
              pluginId
            })
          }

          const result = update(installedPlugins[pluginIndex])

          if (!result.changed) {
            return result
          }

          const rawNewInstalledPlugins = installedPlugins.map((plugin, index) =>
            index === pluginIndex ? result.plugin : plugin
          )

          const parsedNewInstalledPlugins = yield* parseInstalledPluginsArray(
            rawNewInstalledPlugins
          )

          yield* storage.set(
            CONSTANTS.InstalledPlugins,
            parsedNewInstalledPlugins
          )

          return {
            plugin: parsedNewInstalledPlugins[pluginIndex],
            changed: true
          }
        })
      }

      function grantHostPermission(
        pluginId: string,
        permission: Permission | string
      ) {
        return updateInstalledPlugin(pluginId, (plugin) => {
          const key = permissionKey(permission)

          if (plugin.grantedHostPermissions.includes(key)) {
            return { plugin, changed: false }
          }

          return {
            plugin: {
              ...plugin,
              grantedHostPermissions: [
                ...plugin.grantedHostPermissions,
                key
              ]
            },
            changed: true
          }
        })
      }

      function revokeHostPermission(
        pluginId: string,
        permission: Permission | string
      ) {
        return updateInstalledPlugin(pluginId, (plugin) => {
          const key = permissionKey(permission)

          if (!plugin.grantedHostPermissions.includes(key)) {
            return { plugin, changed: false }
          }

          return {
            plugin: {
              ...plugin,
              grantedHostPermissions: plugin.grantedHostPermissions.filter(
                (grantedPermission) => grantedPermission !== key
              )
            },
            changed: true
          }
        })
      }

      function grantRuntimePermission(
        pluginId: string,
        permission: RuntimePermission
      ) {
        return updateInstalledPlugin(pluginId, (plugin) => {
          const key = runtimePermissionKey(permission)
          const hasPermission = plugin.grantedRuntimePermissions.some(
            (grantedPermission) =>
              runtimePermissionKey(grantedPermission) === key
          )

          if (hasPermission) {
            return { plugin, changed: false }
          }

          return {
            plugin: {
              ...plugin,
              grantedRuntimePermissions: [
                ...plugin.grantedRuntimePermissions,
                permission
              ]
            },
            changed: true
          }
        })
      }

      function revokeRuntimePermission(
        pluginId: string,
        permission: RuntimePermission
      ) {
        return updateInstalledPlugin(pluginId, (plugin) => {
          const key = runtimePermissionKey(permission)
          const grantedRuntimePermissions = plugin.grantedRuntimePermissions
            .filter(
              (grantedPermission) =>
                runtimePermissionKey(grantedPermission) !== key
            )

          if (
            grantedRuntimePermissions.length ===
              plugin.grantedRuntimePermissions.length
          ) {
            return { plugin, changed: false }
          }

          return {
            plugin: {
              ...plugin,
              grantedRuntimePermissions
            },
            changed: true
          }
        })
      }

      return {
        getInstalledPlugins,
        getInstalledPlugin,
        installPlugin,
        grantHostPermission,
        revokeHostPermission,
        grantRuntimePermission,
        revokeRuntimePermission
      } as const
    })
  }
) {
  static CONSTANTS = CONSTANTS
}

export type PluginPermissionUpdate = {
  plugin: InstallPlugin
  changed: boolean
}
