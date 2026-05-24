import { Data } from 'effect'

export class PermissionsRequiredError
  extends Data.TaggedError('PermissionsRequiredError')<{
    missingPermissions: Permission[]
  }> {}

/**
 * Defines a permission that a plugin can request from the host. Permissions are
 * used to control access to sensitive features or data in the host, and to
 * provide a clear contract between the host and plugins about what actions a
 * plugin is allowed to perform.
 *
 * @param options - An object containing the properties of the permission,
 * including a unique key, a description, and whether the permission is required
 * or optional.
 * @returns A permission object that can be included in the host's permissions
 * array and requested by plugins when they are installed.
 */
export function permission(options: Permission): Permission {
  const defaultOptions = {
    required: false
  }

  const mergedOptions = {
    ...defaultOptions,
    ...options
  }

  return mergedOptions
}

export type Permission = {
  /**
   * A unique key for the permission, used for checking if a plugin has the
   * permission or not.
   */
  key: string

  /**
   * A human-readable description of the permission, used for logging and
   * debugging purposes.
   */
  description: string
}
