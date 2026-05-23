import { Effect, Logger, PubSub } from 'effect'
import { Supervisor } from './supervisor.ts'
import { PluginManifest } from './plugin.ts'
import type { Message } from './protocol.ts'
import { assert, assertEquals } from '@std/assert'

const examplePlugin = PluginManifest.make({
  id: 'example',
  name: 'Example Plugin',
  requestPermissions: [],
  path: '../testWorker.ts',
  supportedVersions: ['1.0.0'],
  version: '1.0.0'
})

Deno.test('supervisor handles worker start', async () => {
  const effect = Effect.gen(function* () {
    const supervisor = yield* Supervisor

    const ps = yield* PubSub.unbounded<Message>()

    const { id } = yield* supervisor.start({
      givenRuntimePermissions: [],
      pluginManifest: examplePlugin,
      ps
    })

    const workerHandle = yield* supervisor.get(id)

    assert(workerHandle._tag === 'Some')
    assertEquals(yield* workerHandle.value.status, { _tag: 'Running' })
  })

  await Effect.runPromise(effect.pipe(
    Effect.provide(Supervisor.Default),
    Effect.provide(Logger.pretty)
  ))
})
