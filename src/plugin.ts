import type { Host } from './host.ts'
import type { Permission } from './permission.ts'
import type { Hook } from './hook.ts'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { Schema } from 'effect'
import { RuntimePermissionSchema } from './runtimePermission.ts'

const stringArray = Schema.Array(Schema.String)
const runtimePermissionArray = Schema.Array(RuntimePermissionSchema)

const pluginMetadataFields: {
  readonly id: typeof Schema.String
  readonly name: typeof Schema.String
  readonly version: typeof Schema.String
  readonly supportedHostVersions: typeof stringArray
  readonly entrypoint: typeof Schema.String
  readonly requestedHostPermissions: typeof stringArray
  readonly requestedRuntimePermissions: typeof runtimePermissionArray
} = {
  id: Schema.String,
  name: Schema.String,
  version: Schema.String,
  supportedHostVersions: stringArray,
  entrypoint: Schema.String,
  requestedHostPermissions: stringArray,
  requestedRuntimePermissions: runtimePermissionArray
}

export const PluginMetadata: Schema.Struct<typeof pluginMetadataFields> = Schema
  .Struct(pluginMetadataFields)

const installedPluginFields: typeof pluginMetadataFields & {
  readonly grantedHostPermissions: typeof stringArray
  readonly grantedRuntimePermissions: typeof runtimePermissionArray
} = {
  ...pluginMetadataFields,
  grantedHostPermissions: stringArray,
  grantedRuntimePermissions: runtimePermissionArray
}

export const InstalledPlugin: Schema.Struct<typeof installedPluginFields> =
  Schema.Struct(installedPluginFields)

export const PluginManifest = PluginMetadata

export function plugin<
  H extends Host<any>,
  Hooks extends Hook<any, H['$inferRPC'], StandardSchemaV1 | never>[] = Hook<
    any,
    H['$inferRPC'],
    StandardSchemaV1 | never
  >[]
>(
  options: Omit<Plugin<H, Hooks>, 'hooks'> & { hooks?: Hooks }
): Plugin<H, Hooks> {
  const defaultOptions = {
    hooks: [] as unknown as Hooks
  }

  const mergedOptions = {
    ...defaultOptions,
    ...options
  }

  return mergedOptions as Plugin<H, Hooks>
}

export type Plugin<
  H extends Host<any>,
  Hooks extends Hook<any, H['$inferRPC'], any>[] = []
> = {
  /**
   * The unique identifier of the plugin. This is used for storing plugin data
   * and for distinguishing between different plugins. It should be a string in
   * kebab-case format (e.g., "my-plugin").
   */
  id: string

  /**
   * The name of the plugin, used for logging and debugging purposes.
   */
  name: string

  /**
   * The version of the plugin, following semantic versioning (e.g., "1.0.0").
   */
  version: string

  /**
   * The versions of the host that the plugin supports. This can be a list of
   * version ranges (e.g., [">=1.0.0", "<2.0.0"]) or a single version range
   * (e.g., ">=1.0.0 <2.0.0").
   */
  supportedHostVersions: string[] | string

  /**
   * The permissions that the plugin requests from the host. The host can use
   * this information to determine whether to allow the plugin to be installed
   * based on the permissions granted to the plugin.
   */
  requestedHostPermissions: Permission[]

  /**
   * Hooks that the plugin registers to listen for specific events in the host.
   * This allows the plugin to execute code in response to certain actions or
   * lifecycle events in the host.
   */
  hooks: Hooks
}

export type PluginMetadata = typeof PluginMetadata.Type

export type InstalledPlugin = typeof InstalledPlugin.Type

export type InstallPlugin = InstalledPlugin

export type PluginManifest = PluginMetadata
