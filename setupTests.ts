import { setup, teardown } from '@ark/attest'
import { isDebugEnabled } from './src/log.ts'

Deno.test.beforeAll(() => {
  setup()

  if (isDebugEnabled) {
    console.log('[setupTests] WEAVER_DEBUG is enabled — debug logging active')
  }
})

Deno.test.afterAll(() => {
  teardown()
})
