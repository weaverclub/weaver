import { attest } from '@ark/attest'
import { type Permission, permission } from './permission.ts'

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
