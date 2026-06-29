import { assertEquals } from '@std/assert'
import {
  env,
  net,
  read,
  runtimePermissionKey,
  toDenoPermission
} from './runtimePermission.ts'

Deno.test('runtimePermissionKey() ignores value ordering', () => {
  assertEquals(
    runtimePermissionKey(net(['api.example.com', 'cdn.example.com'])),
    runtimePermissionKey(net(['cdn.example.com', 'api.example.com']))
  )
})

Deno.test('toDenoPermission() merges permissions of the same type', () => {
  assertEquals(
    toDenoPermission([
      net(['api.example.com']),
      net(['cdn.example.com']),
      read(['/tmp']),
      read(['/var/tmp'])
    ]),
    {
      net: ['api.example.com', 'cdn.example.com'],
      read: ['/tmp', '/var/tmp']
    }
  )
})

Deno.test('toDenoPermission() keeps unrestricted grants unrestricted', () => {
  assertEquals(
    toDenoPermission([
      env(['PLUGIN_TOKEN']),
      env()
    ]),
    {
      env: true
    }
  )
})
