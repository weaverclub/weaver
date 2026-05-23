import { Schema } from 'effect'
import { type Event, event } from './event.ts'
import { attest } from '@ark/attest'
import { assertEquals } from '@std/assert'

Deno.test('event() returns the event object', () => {
  const payload = Schema.standardSchemaV1(Schema.String)

  const myEvent = event({
    key: 'after-greet',
    description: 'Fired after a greeting',
    payload
  })

  assertEquals(myEvent.key, 'after-greet')
  assertEquals(myEvent.description, 'Fired after a greeting')
  assertEquals(myEvent.payload, payload)

  attest<Event<typeof payload>>(myEvent)
})

Deno.test('event() with number payload', () => {
  const payload = Schema.standardSchemaV1(Schema.Number)

  const myEvent = event({
    key: 'on-count',
    description: 'Fired when count changes',
    payload
  })

  assertEquals(myEvent.key, 'on-count')
  assertEquals(myEvent.description, 'Fired when count changes')
  assertEquals(myEvent.payload, payload)

  attest<Event<typeof payload>>(myEvent)
})

Deno.test('event() with object payload', () => {
  const payload = Schema.standardSchemaV1(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String
    })
  )

  const myEvent = event({
    key: 'user-created',
    description: 'Fired when a user is created',
    payload
  })

  assertEquals(myEvent.key, 'user-created')
  assertEquals(myEvent.description, 'Fired when a user is created')
  assertEquals(myEvent.payload, payload)

  attest<Event<typeof payload>>(myEvent)
})
