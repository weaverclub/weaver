import { setup, teardown } from '@ark/attest'

Deno.test.beforeAll(() => {
  setup()
})

Deno.test.afterAll(() => {
  teardown()
})
