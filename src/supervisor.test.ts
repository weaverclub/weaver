import { Effect, Fiber, PubSub, Queue, Ref } from 'effect'
import { Supervisor } from './supervisor.ts'
import { PluginManifest } from './plugin.ts'
import type { WorkerMessage } from './protocol.ts'
import { assert, assertEquals } from '@std/assert'
import { LoggerLayer, MinimumLogLevelLayer } from './log.ts'

const runningPlugin = PluginManifest.make({
  id: 'running',
  name: 'Running Plugin',
  requestPermissions: [],
  path: '../test-workers/testWorker.ts',
  supportedVersions: ['1.0.0'],
  version: '1.0.0'
})

const messagePlugin = PluginManifest.make({
  id: 'message',
  name: 'Message Plugin',
  requestPermissions: [],
  path: '../test-workers/testMessageWorker.ts',
  supportedVersions: ['1.0.0'],
  version: '1.0.0'
})

const crashPlugin = PluginManifest.make({
  id: 'crash',
  name: 'Crash Plugin',
  requestPermissions: [],
  path: '../test-workers/testCrashWorker.ts',
  supportedVersions: ['1.0.0'],
  version: '1.0.0'
})

const runSupervisor = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(Supervisor.Default),
      Effect.provide(LoggerLayer),
      Effect.provide(MinimumLogLevelLayer)
    ) as Effect.Effect<A, E, never>
  )

Deno.test('supervisor handles worker start', async () => {
  const effect = Effect.gen(function* () {
    const supervisor = yield* Supervisor
    const ps = yield* PubSub.unbounded<WorkerMessage>()

    const { id } = yield* supervisor.start({
      givenRuntimePermissions: [],
      pluginManifest: runningPlugin,
      ps
    })

    const workerHandle = yield* supervisor.get(id)
    assert(workerHandle._tag === 'Some')
    assertEquals(yield* workerHandle.value.status, { _tag: 'Running' })
  })

  await runSupervisor(effect)
})

Deno.test('supervisor returns None for unknown worker', async () => {
  const effect = Effect.gen(function* () {
    const supervisor = yield* Supervisor
    const handle = yield* supervisor.get(
      '00000000-0000-0000-0000-000000000000' as any
    )
    assert(handle._tag === 'None')
  })

  await runSupervisor(effect)
})

Deno.test('supervisor handles worker messages', async () => {
  const effect = Effect.gen(function* () {
    const supervisor = yield* Supervisor
    const ps = yield* PubSub.unbounded<WorkerMessage>()
    const subscription = yield* PubSub.subscribe(ps)

    const { id } = yield* supervisor.start({
      givenRuntimePermissions: [],
      pluginManifest: messagePlugin,
      ps
    })

    const msg = yield* Queue.take(subscription).pipe(
      Effect.timeout('5 seconds')
    )
    assertEquals(msg.message.event, 'test.message')
    assertEquals(msg.message.payload, { value: 42 })

    yield* supervisor.interrupt(id)
  })

  await runSupervisor(Effect.scoped(effect))
})

Deno.test('supervisor handles worker interrupt', async () => {
  const effect = Effect.gen(function* () {
    const supervisor = yield* Supervisor
    const ps = yield* PubSub.unbounded<WorkerMessage>()

    const { id, fiber, status } = yield* supervisor.start({
      givenRuntimePermissions: [],
      pluginManifest: runningPlugin,
      ps
    })

    yield* supervisor.interrupt(id)
    yield* Fiber.await(fiber).pipe(Effect.timeout('5 seconds'))

    const finalStatus = yield* Ref.get(status)
    assertEquals(finalStatus._tag, 'Interrupted')

    const handle = yield* supervisor.get(id)
    assert(handle._tag === 'None')
  })

  await runSupervisor(effect)
})

Deno.test('supervisor handles worker crash', async () => {
  const effect = Effect.gen(function* () {
    const supervisor = yield* Supervisor
    const ps = yield* PubSub.unbounded<WorkerMessage>()

    const { id, fiber, status } = yield* supervisor.start({
      givenRuntimePermissions: [],
      pluginManifest: crashPlugin,
      ps
    })

    const exit = yield* Fiber.await(fiber).pipe(
      Effect.timeout('10 seconds')
    )
    assert(exit._tag === 'Failure')

    const finalStatus = yield* Ref.get(status)
    assert(finalStatus._tag === 'Crashed')

    const handle = yield* supervisor.get(id)
    assert(handle._tag === 'Some')
    assertEquals(yield* Ref.get(handle.value.status), finalStatus)
  })

  await runSupervisor(effect)
})
