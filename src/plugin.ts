import type { Host } from './host.ts'
import type { Permission } from './permission.ts'
import type { Hook } from './hook.ts'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { Schema } from 'effect'

export const PluginManifest = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  version: Schema.String,
  supportedVersions: Schema.Array(Schema.String),
  requestPermissions: Schema.Array(Schema.String),
  path: Schema.String
})

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
  supportedVersions: string[] | string

  /**
   * The permissions that the plugin requests from the host. The host can use
   * this information to determine whether to allow the plugin to be installed
   * based on the permissions granted to the plugin.
   */
  requestPermissions: Permission[]

  /**
   * Hooks that the plugin registers to listen for specific events in the host.
   * This allows the plugin to execute code in response to certain actions or
   * lifecycle events in the host.
   */
  hooks: Hooks
}

export type PluginManifest = typeof PluginManifest.Type
