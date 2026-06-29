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
  'DisabledPlugins': '__weaver_disabled_plugins__',
  'OnInstall': LifecycleEvent.OnInstall,
  'OnStart': LifecycleEvent.OnStart
}

const parseInstalledPluginsArray = Schema.decodeUnknown(
  Schema.Array(InstalledPlugin)
)
const parseDisabledPluginIdsArray = Schema.decodeUnknown(
  Schema.Array(Schema.String)
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

      function initializeDisabledPluginIds() {
        return Effect.gen(function* () {
          yield* storage.set(CONSTANTS.DisabledPlugins, [])
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

      function getDisabledPluginIds() {
        return Effect.gen(function* () {
          const rawDisabledPluginIds = yield* storage.get(
            CONSTANTS.DisabledPlugins
          )

          return yield* parseDisabledPluginIdsArray(rawDisabledPluginIds)
        }).pipe(
          Effect.catchTag(
            'ItemNotFoundError',
            () =>
              initializeDisabledPluginIds().pipe(
                Effect.andThen(() => [] as string[])
              )
          )
        )
      }

      function setInstalledPlugins(plugins: readonly InstallPlugin[]) {
        return Effect.gen(function* () {
          const parsedInstalledPlugins = yield* parseInstalledPluginsArray(
            [...plugins]
          )

          yield* storage.set(
            CONSTANTS.InstalledPlugins,
            parsedInstalledPlugins
          )

          return parsedInstalledPlugins
        })
      }

      function setDisabledPluginIds(pluginIds: readonly string[]) {
        return Effect.gen(function* () {
          const parsedDisabledPluginIds = yield* parseDisabledPluginIdsArray(
            [...new Set(pluginIds)]
          )

          yield* storage.set(
            CONSTANTS.DisabledPlugins,
            parsedDisabledPluginIds
          )

          return parsedDisabledPluginIds
        })
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

      function isPluginDisabled(pluginId: string) {
        return getDisabledPluginIds().pipe(
          Effect.map((disabledPluginIds) =>
            disabledPluginIds.includes(pluginId)
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

          yield* setInstalledPlugins([...installedPlugins, plugin])
        })
      }

      function uninstallPlugin(pluginId: string) {
        return Effect.gen(function* () {
          const installedPlugins = yield* getInstalledPlugins()
          const plugin = installedPlugins.find((p) => p.id === pluginId)

          if (plugin === undefined) {
            return yield* new PluginNotInstalledError({
              pluginId
            })
          }

          yield* setInstalledPlugins(
            installedPlugins.filter((p) => p.id !== pluginId)
          )

          const disabledPluginIds = yield* getDisabledPluginIds()
          yield* setDisabledPluginIds(
            disabledPluginIds.filter((id) => id !== pluginId)
          )

          return {
            plugin,
            changed: true
          }
        })
      }

      function updatePlugin(plugin: InstallPlugin) {
        return Effect.gen(function* () {
          const installedPlugins = yield* getInstalledPlugins()
          const pluginIndex = installedPlugins.findIndex(
            (p) => p.id === plugin.id
          )

          if (pluginIndex === -1) {
            return yield* new PluginNotInstalledError({
              pluginId: plugin.id
            })
          }

          const previousPlugin = installedPlugins[pluginIndex]
          const changed = stableStringify(previousPlugin) !==
            stableStringify(plugin)

          if (!changed) {
            return {
              previousPlugin,
              plugin: previousPlugin,
              changed: false
            }
          }

          const parsedInstalledPlugins = yield* setInstalledPlugins(
            installedPlugins.map((installedPlugin, index) =>
              index === pluginIndex ? plugin : installedPlugin
            )
          )

          return {
            previousPlugin,
            plugin: parsedInstalledPlugins[pluginIndex],
            changed: true
          }
        })
      }

      function disablePlugin(pluginId: string) {
        return Effect.gen(function* () {
          const plugin = yield* getInstalledPlugin(pluginId)
          const disabledPluginIds = yield* getDisabledPluginIds()

          if (disabledPluginIds.includes(pluginId)) {
            return {
              plugin,
              changed: false
            }
          }

          yield* setDisabledPluginIds([...disabledPluginIds, pluginId])

          return {
            plugin,
            changed: true
          }
        })
      }

      function enablePlugin(pluginId: string) {
        return Effect.gen(function* () {
          const plugin = yield* getInstalledPlugin(pluginId)
          const disabledPluginIds = yield* getDisabledPluginIds()

          if (!disabledPluginIds.includes(pluginId)) {
            return {
              plugin,
              changed: false
            }
          }

          yield* setDisabledPluginIds(
            disabledPluginIds.filter((id) => id !== pluginId)
          )

          return {
            plugin,
            changed: true
          }
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

          const parsedInstalledPlugins = yield* setInstalledPlugins(
            installedPlugins.map((plugin, index) =>
              index === pluginIndex ? result.plugin : plugin
            )
          )

          return {
            plugin: parsedInstalledPlugins[pluginIndex],
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
        getDisabledPluginIds,
        isPluginDisabled,
        installPlugin,
        uninstallPlugin,
        updatePlugin,
        disablePlugin,
        enablePlugin,
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

export type PluginReplacementUpdate = {
  previousPlugin: InstallPlugin
  plugin: InstallPlugin
  changed: boolean
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }

  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b))

    return `{${
      entries.map(([key, entryValue]) =>
        `${JSON.stringify(key)}:${stableStringify(entryValue)}`
      ).join(',')
    }}`
  }

  return JSON.stringify(value)
}
