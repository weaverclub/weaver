import { attest } from '@ark/attest'
import { assertEquals } from '@std/assert'
import {
  hasPermissions,
  missingPermissions,
  type Permission,
  permission,
  permissionKey,
  requirePermissions
} from './permission.ts'
import { Effect, Exit } from 'effect'

Deno.test('permission() returns the permission object', () => {
  const myPermission = permission({
    key: 'my-permission',
    description: 'This is my permission'
  })

  attest<Permission>(myPermission).equals({
    key: 'my-permission',
    description: 'This is my permission'
  })
})

Deno.test('permission() sets required to false by default', () => {
  const myPermission = permission({
    key: 'my-permission',
    description: 'This is my permission'
  })

  attest<Permission>(myPermission).equals({
    key: 'my-permission',
    description: 'This is my permission'
  })
})

Deno.test('permissionKey() accepts permission objects and raw keys', () => {
  const myPermission = permission({
    key: 'my-permission',
    description: 'This is my permission'
  })

  assertEquals(permissionKey(myPermission), 'my-permission')
  assertEquals(permissionKey('my-permission'), 'my-permission')
})

Deno.test('hasPermissions() checks granted permission keys', () => {
  const manageTasks = permission({
    key: 'manage-tasks',
    description: 'Manage tasks'
  })
  const deleteTasks = permission({
    key: 'delete-tasks',
    description: 'Delete tasks'
  })

  assertEquals(hasPermissions(['manage-tasks'], [manageTasks]), true)
  assertEquals(hasPermissions(['manage-tasks'], [deleteTasks]), false)
})

Deno.test('missingPermissions() returns missing permission definitions', () => {
  const manageTasks = permission({
    key: 'manage-tasks',
    description: 'Manage tasks'
  })
  const deleteTasks = permission({
    key: 'delete-tasks',
    description: 'Delete tasks'
  })

  assertEquals(
    missingPermissions(['manage-tasks'], [
      manageTasks,
      deleteTasks
    ]),
    [deleteTasks]
  )
})

Deno.test('requirePermissions() fails when grants are missing', async () => {
  const manageTasks = permission({
    key: 'manage-tasks',
    description: 'Manage tasks'
  })

  const exit = await Effect.runPromiseExit(
    requirePermissions([], [manageTasks])
  )

  assertEquals(Exit.isFailure(exit), true)
})
