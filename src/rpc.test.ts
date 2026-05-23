import { Effect, Schema } from 'effect'
import { UnknownException } from 'effect/Cause'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import {
  $call,
  HandlerError,
  InvalidInputError,
  InvalidInputUnknownError,
  InvalidOutputError,
  InvalidOutputUnknownError,
  type RPC,
  rpc
} from './rpc.ts'
import { postExecution, postFailure, preExecution } from './hook.ts'
import { attest } from '@ark/attest'
import { assert, assertEquals, assertInstanceOf } from '@std/assert'

Deno.test('rpc() returns the rpc object', () => {
  const input = Schema.standardSchemaV1(Schema.String)
  const output = Schema.standardSchemaV1(Schema.Number)

  const myRpc = rpc({
    input,
    output,
    handler: (input) => input.length
  })

  attest<
    RPC<typeof input, typeof output>
  >(myRpc)
})

Deno.test('rpc() with async handler', () => {
  const input = Schema.standardSchemaV1(Schema.String)
  const output = Schema.standardSchemaV1(Schema.Number)

  const myRpc = rpc({
    input,
    output,
    handler: async (input) => {
      await Effect.runPromise(Effect.void)
      return input.length
    }
  })

  attest<
    RPC<typeof input, typeof output>
  >(myRpc)
})

Deno.test('rpc() with different input and output schemas', () => {
  const input = Schema.standardSchemaV1(Schema.NumberFromString)
  const output = Schema.standardSchemaV1(Schema.DateFromString)

  const myRpc = rpc({
    input,
    output,
    handler: (input) => {
      attest<number>(input)
      return new Date(input).toISOString()
    }
  })

  attest<
    RPC<typeof input, typeof output>
  >(myRpc)
})

Deno.test('rpc() with void output', () => {
  const input = Schema.standardSchemaV1(Schema.String)

  const myRpc = rpc({
    input,
    handler: () => {
      Effect.runSync(Effect.void)
    }
  })

  attest<
    RPC<typeof input, void>
  >(myRpc)
})

Deno.test('rpc() with void output and async handler', () => {
  const input = Schema.standardSchemaV1(Schema.String)

  const myRpc = rpc({
    input,
    handler: async () => {
      await Effect.runPromise(Effect.void)
    }
  })

  attest<
    RPC<typeof input, void>
  >(myRpc)
})

Deno.test('rpc() with hooks', () => {
  const input = Schema.standardSchemaV1(Schema.String)
  const output = Schema.standardSchemaV1(Schema.Number)

  const myRpc = rpc({
    input,
    output,
    handler: (input) => input.length,
    hooks: [
      postExecution((ctx) => {
        attest<string>(ctx.input)
        attest<number>(ctx.output)
      })
    ]
  })

  attest<
    RPC<typeof input, typeof output>
  >(myRpc)
})

Deno.test('rpc() with hooks and void output', () => {
  const input = Schema.standardSchemaV1(Schema.String)

  const myRpc = rpc({
    input,
    handler: () => {
      Effect.runSync(Effect.void)
    },
    hooks: [
      postExecution((ctx) => {
        attest<string>(ctx.input)
      })
    ]
  })

  attest<
    RPC<typeof input, void>
  >(myRpc)
})

Deno.test('rpc() with preExecution helper', () => {
  const input = Schema.standardSchemaV1(Schema.String)
  const output = Schema.standardSchemaV1(Schema.Number)

  const myRpc = rpc({
    input,
    output,
    handler: (input) => input.length,
    hooks: [
      preExecution((_ctx) => {})
    ]
  })

  attest<
    RPC<typeof input, typeof output>
  >(myRpc)
})

Deno.test('rpc() with postExecution helper', () => {
  const input = Schema.standardSchemaV1(Schema.String)
  const output = Schema.standardSchemaV1(Schema.Number)

  const myRpc = rpc({
    input,
    output,
    handler: (input) => input.length,
    hooks: [
      postExecution((_ctx) => {})
    ]
  })

  attest<
    RPC<typeof input, typeof output>
  >(myRpc)
})

Deno.test('rpc() with postFailure helper', () => {
  const input = Schema.standardSchemaV1(Schema.String)
  const output = Schema.standardSchemaV1(Schema.Number)

  const myRpc = rpc({
    input,
    output,
    handler: (input) => input.length,
    hooks: [
      postFailure((_ctx) => {})
    ]
  })

  attest<
    RPC<typeof input, typeof output>
  >(myRpc)
})

Deno.test('rpc() with multiple hook helpers', () => {
  const input = Schema.standardSchemaV1(Schema.String)
  const output = Schema.standardSchemaV1(Schema.Number)

  const myRpc = rpc({
    input,
    output,
    handler: (input) => input.length,
    hooks: [
      preExecution((ctx) => {
        attest<string>(ctx.input)
      }),
      postExecution((ctx) => {
        attest<string>(ctx.input)
        attest<number>(ctx.output)
      }),
      postFailure((ctx) => {
        attest<unknown>(ctx.error)
      })
    ]
  })

  attest<
    RPC<typeof input, typeof output>
  >(myRpc)
})

Deno.test('rpc() with postExecution helper and void output', () => {
  const input = Schema.standardSchemaV1(Schema.String)

  const myRpc = rpc({
    input,
    handler: () => {
      Effect.runSync(Effect.void)
    },
    hooks: [
      postExecution((_ctx) => {})
    ]
  })

  attest<
    RPC<typeof input, void>
  >(myRpc)
})

Deno.test('$call() returns the correct output', async () => {
  const input = Schema.standardSchemaV1(Schema.String)
  const output = Schema.standardSchemaV1(Schema.NumberFromString)

  const myRpc = rpc({
    input,
    output,
    handler: (input) => input.length.toString()
  })

  const result = await Effect.runPromise($call(myRpc, 'hello'))

  assertEquals(result, 5)
})

Deno.test('$call() with async handler returns the correct output', async () => {
  const input = Schema.standardSchemaV1(Schema.String)
  const output = Schema.standardSchemaV1(Schema.NumberFromString)

  const myRpc = rpc({
    input,
    output,
    handler: async (input) => {
      await Effect.runPromise(Effect.void)
      return input.length.toString()
    }
  })

  const result = await Effect.runPromise($call(myRpc, 'weaver'))

  assertEquals(result, 6)
})

Deno.test('$call() with void output returns void', async () => {
  const input = Schema.standardSchemaV1(Schema.String)

  const myRpc = rpc({
    input,
    handler: async () => {
      await Effect.runPromise(Effect.void)
    }
  })

  const result = await Effect.runPromise($call(myRpc, 'test'))

  assertEquals(result, undefined)
})

Deno.test('$call() with invalid input returns InvalidInputError', async () => {
  const input = Schema.standardSchemaV1(Schema.NumberFromString)
  const output = Schema.standardSchemaV1(Schema.String)

  const myRpc = rpc({
    input,
    output,
    handler: (input) => input.toString()
  })

  const result = await Effect.runPromiseExit($call(myRpc, 'not a number'))

  assert(result._tag === 'Failure')
  assert(result.cause._tag === 'Fail')
  assertInstanceOf(result.cause.error, InvalidInputError)
})

Deno.test('$call() with handler throwing an error returns HandlerError', async () => {
  const input = Schema.standardSchemaV1(Schema.String)
  const output = Schema.standardSchemaV1(Schema.String)

  const myRpc = rpc({
    input,
    output,
    handler: () => {
      throw new Error('Handler error')
    }
  })

  const result = await Effect.runPromiseExit($call(myRpc, 'test'))

  assert(result._tag === 'Failure')
  assert(result.cause._tag === 'Fail')
  assertInstanceOf(result.cause.error, HandlerError)
})

Deno.test('$call() with invalid output returns InvalidOutputError', async () => {
  const input = Schema.standardSchemaV1(Schema.String)
  const output = Schema.standardSchemaV1(Schema.NumberFromString)

  const myRpc = rpc({
    input,
    output,
    handler: () => 'not a number'
  })

  const result = await Effect.runPromiseExit($call(myRpc, 'test'))

  assert(result._tag === 'Failure')
  assert(result.cause._tag === 'Fail')
  assertInstanceOf(result.cause.error, InvalidOutputError)
})

Deno.test('$call() with input schema throwing returns InvalidInputUnknownError', async () => {
  const throwingSchema: StandardSchemaV1 = {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: () => {
        throw new Error('schema exploded')
      }
    }
  }

  const output = Schema.standardSchemaV1(Schema.String)

  const myRpc = rpc({
    input: throwingSchema,
    output,
    handler: (input: unknown) => String(input)
  })

  const result = await Effect.runPromiseExit($call(myRpc, 'test'))

  assert(result._tag === 'Failure')
  assert(result.cause._tag === 'Fail')
  assertInstanceOf(result.cause.error, InvalidInputUnknownError)
  assertInstanceOf(result.cause.error.cause, UnknownException)
})

Deno.test('$call() with output schema throwing returns InvalidOutputUnknownError', async () => {
  const input = Schema.standardSchemaV1(Schema.String)
  const throwingSchema: StandardSchemaV1 = {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: () => {
        throw new Error('schema exploded')
      }
    }
  }

  const myRpc = rpc({
    input,
    output: throwingSchema,
    handler: () => 'some output'
  })

  const result = await Effect.runPromiseExit($call(myRpc, 'test'))

  assert(result._tag === 'Failure')
  assert(result.cause._tag === 'Fail')
  assertInstanceOf(result.cause.error, InvalidOutputUnknownError)
  assertInstanceOf(result.cause.error.cause, UnknownException)
})
