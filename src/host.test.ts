import { Schema } from 'effect'
import { type RPC, rpc } from './rpc.ts'
import { type Host, host } from './host.ts'
import { attest } from '@ark/attest'

Deno.test('host() returns the host object', () => {
  const input = Schema.standardSchemaV1(Schema.String)
  const output = Schema.standardSchemaV1(Schema.Number)

  const myRpc = rpc({
    input,
    output,
    handler: (input) => Promise.resolve(input.length)
  })

  const myHost = host({
    name: 'My Host',
    version: '1.0.0',
    rpc: {
      myRpc
    }
  })

  attest<
    Host<{
      myRpc: RPC<typeof input, typeof output>
    }>
  >(myHost)
})
