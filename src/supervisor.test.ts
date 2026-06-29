import { assert, assertEquals } from '@std/assert'
import { Effect, Fiber, PubSub, Queue, Ref } from 'effect'
import { LoggerLayer, MinimumLogLevelLayer } from './log.ts'
import { PluginManifest } from './plugin.ts'
import type { WorkerMessage } from './protocol.ts'
import { net } from './runtimePermission.ts'
import { Supervisor, type WorkerLifecycleEvent } from './supervisor.ts'

const runningPlugin = PluginManifest.make({
  id: 'running',
  name: 'Running Plugin',
  requestedHostPermissions: [],
  requestedRuntimePermissions: [],
  entrypoint: '../test-workers/testWorker.ts',
  supportedHostVersions: ['1.0.0'],
  version: '1.0.0'
})

const messagePlugin = PluginManifest.make({
  id: 'message',
  name: 'Message Plugin',
  requestedHostPermissions: [],
  requestedRuntimePermissions: [],
  entrypoint: '../test-workers/testMessageWorker.ts',
  supportedHostVersions: ['1.0.0'],
  version: '1.0.0'
})

const crashPlugin = PluginManifest.make({
  id: 'crash',
  name: 'Crash Plugin',
  requestedHostPermissions: [],
  requestedRuntimePermissions: [],
  entrypoint: '../test-workers/testCrashWorker.ts',
  supportedHostVersions: ['1.0.0'],
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

function withWorkerOptionsSpy<T>(
  fn: (options: (WorkerOptions | undefined)[]) => Promise<T>
): Promise<T> {
  const optionsList: (WorkerOptions | undefined)[] = []
  const OriginalWorker = globalThis.Worker

  class SpyWorker extends Worker {
    constructor(specifier: string | URL, options?: WorkerOptions) {
      optionsList.push(options)
      super(specifier, options)
    }
  }

  globalThis.Worker = SpyWorker as any

  return fn(optionsList).finally(() => {
    globalThis.Worker = OriginalWorker
  })
}

Deno.test('supervisor handles worker start', async () => {
  const effect = Effect.gen(function* () {
    const supervisor = yield* Supervisor
    const workerMessages = yield* PubSub.unbounded<WorkerMessage>()
    const workerLifecycleEvents = yield* PubSub.unbounded<
      WorkerLifecycleEvent
    >()

    const { id } = yield* supervisor.start({
      grantedRuntimePermissions: [],
      pluginManifest: runningPlugin,
      workerMessages,
      workerLifecycleEvents
    })

    const workerHandle = yield* supervisor.get(id)
    assert(workerHandle._tag === 'Some')
    assertEquals(yield* workerHandle.value.status, { _tag: 'Running' })
  })

  await runSupervisor(effect)
})

Deno.test('supervisor finds worker by plugin id', async () => {
  const effect = Effect.gen(function* () {
    const supervisor = yield* Supervisor
    const workerMessages = yield* PubSub.unbounded<WorkerMessage>()
    const workerLifecycleEvents = yield* PubSub.unbounded<
      WorkerLifecycleEvent
    >()

    const { id } = yield* supervisor.start({
      grantedRuntimePermissions: [],
      pluginManifest: runningPlugin,
      workerMessages,
      workerLifecycleEvents
    })

    const workerHandle = yield* supervisor.getByPluginId(runningPlugin.id)
    assert(workerHandle._tag === 'Some')
    assertEquals(workerHandle.value.id, id)
  })

  await runSupervisor(effect)
})

Deno.test('supervisor starts worker with granted Deno permissions', async () => {
  await withWorkerOptionsSpy(async (optionsList) => {
    const effect = Effect.gen(function* () {
      const supervisor = yield* Supervisor
      const workerMessages = yield* PubSub.unbounded<WorkerMessage>()
      const workerLifecycleEvents = yield* PubSub.unbounded<
        WorkerLifecycleEvent
      >()

      const { id } = yield* supervisor.start({
        grantedRuntimePermissions: [net(['api.example.com'])],
        pluginManifest: runningPlugin,
        workerMessages,
        workerLifecycleEvents
      })

      yield* supervisor.interrupt(id)
    })

    await runSupervisor(effect)

    assertEquals((optionsList[0] as any).deno.permissions, {
      net: ['api.example.com']
    })
  })
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
    const workerMessages = yield* PubSub.unbounded<WorkerMessage>()
    const workerLifecycleEvents = yield* PubSub.unbounded<
      WorkerLifecycleEvent
    >()
    const subscription = yield* PubSub.subscribe(workerMessages)

    const { id } = yield* supervisor.start({
      grantedRuntimePermissions: [],
      pluginManifest: messagePlugin,
      workerMessages,
      workerLifecycleEvents
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
    const workerMessages = yield* PubSub.unbounded<WorkerMessage>()
    const workerLifecycleEvents = yield* PubSub.unbounded<
      WorkerLifecycleEvent
    >()

    const { id, fiber, status } = yield* supervisor.start({
      grantedRuntimePermissions: [],
      pluginManifest: runningPlugin,
      workerMessages,
      workerLifecycleEvents
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
    const workerMessages = yield* PubSub.unbounded<WorkerMessage>()
    const workerLifecycleEvents = yield* PubSub.unbounded<
      WorkerLifecycleEvent
    >()

    const { id, fiber, status } = yield* supervisor.start({
      grantedRuntimePermissions: [],
      pluginManifest: crashPlugin,
      workerMessages,
      workerLifecycleEvents
    })

    const exit = yield* Fiber.await(fiber).pipe(
      Effect.timeout('10 seconds')
    )
    assert(exit._tag === 'Failure')

    const finalStatus = yield* Ref.get(status)
    assert(finalStatus._tag === 'Crashed')
    assertEquals(finalStatus.restartCount, 5)

    const handle = yield* supervisor.get(id)
    assert(handle._tag === 'Some')
    assertEquals(yield* Ref.get(handle.value.status), finalStatus)
  })

  await runSupervisor(effect)
})
