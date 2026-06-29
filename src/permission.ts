import { Data, Effect } from 'effect'

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
  const defaultOptions = {}

  const mergedOptions = {
    ...defaultOptions,
    ...options
  }

  return mergedOptions
}

export function permissionKey(permission: Permission | string): string {
  return typeof permission === 'string' ? permission : permission.key
}

export function missingPermissions(
  grantedPermissionKeys: readonly string[],
  requiredPermissions: readonly Permission[]
): Permission[] {
  return requiredPermissions.filter(
    (requiredPermission) =>
      !grantedPermissionKeys.includes(requiredPermission.key)
  )
}

export function hasPermissions(
  grantedPermissionKeys: readonly string[],
  requiredPermissions: readonly Permission[]
): boolean {
  return missingPermissions(
    grantedPermissionKeys,
    requiredPermissions
  ).length === 0
}

export function requirePermissions(
  grantedPermissionKeys: readonly string[],
  requiredPermissions: readonly Permission[]
): Effect.Effect<void, PermissionsRequiredError> {
  return Effect.gen(function* () {
    const missing = missingPermissions(
      grantedPermissionKeys,
      requiredPermissions
    )

    if (missing.length > 0) {
      return yield* new PermissionsRequiredError({
        missingPermissions: missing
      })
    }
  })
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
