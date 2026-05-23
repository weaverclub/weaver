import { assertEquals } from '@std/assert'
import {
  type Hook,
  type Logger,
  on,
  onInstall,
  postExecution,
  type PostExecutionHook,
  postFailure,
  type PostFailureHook,
  preExecution,
  type PreExecutionHook
} from './hook.ts'
import { attest } from '@ark/attest'
import { Schema } from 'effect'
import { event } from './event.ts'

Deno.test('onInstall() creates a hook with the correct event and handler', () => {
  const handler = (ctx: { rpc: any; log: Logger }) => {
    ctx.log.info('Handler called')
  }

  const hook = onInstall(handler)

  attest<Hook<'on-install', any>>(hook)
  assertEquals(hook.event, 'on-install')
  assertEquals(hook.handler, handler)
})

Deno.test('on() creates a hook with the correct event and handler', () => {
  const myEvent = event({
    key: 'my-event',
    description: 'A test event',
    payload: Schema.standardSchemaV1(Schema.String)
  })

  const hook = on(myEvent, () => {})

  attest<Hook<string, any>>(hook)
})

Deno.test('preExecution() returns the handler typed as PreExecutionHook', () => {
  const handler: PreExecutionHook<string> = (_ctx) => {}

  const hook = preExecution(handler)

  assertEquals(hook, handler)
})

Deno.test('postExecution() returns the handler typed as PostExecutionHook', () => {
  const handler: PostExecutionHook<string, number> = (_ctx) => {}

  const hook = postExecution(handler)

  assertEquals(hook, handler)
})

Deno.test('postFailure() returns the handler typed as PostFailureHook', () => {
  const handler: PostFailureHook<string> = (_ctx) => {}

  const hook = postFailure(handler)

  assertEquals(hook, handler)
})
