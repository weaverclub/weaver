import {
  Cause,
  Data,
  Deferred,
  Effect,
  Exit,
  FiberMap,
  HashMap,
  Option,
  PubSub,
  Queue,
  Ref,
  Schedule,
  Schema,
  Scope
} from 'effect'
import type { PluginManifest } from './plugin.ts'
import {
  type RuntimePermission,
  toDenoPermission
} from './runtimePermission.ts'
import { parseMessage, WorkerMessage } from './protocol.ts'

export const WorkerId = Schema.UUID.pipe(Schema.brand('WorkerId'))

export class WorkerCrashedError extends Data.TaggedError('WorkerCrashedError')<{
  workerId: WorkerId
  event: ErrorEvent
}> {}

export class WorkerDeserializationError
  extends Data.TaggedError('WorkerDeserializationError')<{
    workerId: WorkerId
    event: MessageEvent
  }> {}

function acquireWorker(
  { pluginManifest, givenRuntimePermissions }: AcquireWorkerOptions
) {
  return Effect.sync(() => new URL(pluginManifest.path, import.meta.url)).pipe(
    Effect.tap((url) =>
      Effect.logDebug('Resolved worker URL', { url: url.href })
    ),
    Effect.map((url) =>
      new Worker(url, {
        type: 'module',
        deno: {
          permissions: toDenoPermission(givenRuntimePermissions)
        }
      })
    ),
    Effect.tap(() => Effect.logDebug('Worker instance created')),
    Effect.acquireRelease(
      (worker) => Effect.sync(() => worker.terminate())
    )
  )
}

function setupWorker(
  handle: Pick<
    WorkerHandle,
    'id' | 'pluginManifest' | 'givenRuntimePermissions' | 'worker'
  >
) {
  return Effect.gen(function* () {
    yield* Effect.logDebug('Setting up worker handlers', {
      workerId: handle.id
    })

    const crashed = yield* Deferred.make<
      never,
      WorkerCrashedError | WorkerDeserializationError
    >()
    const inbox = yield* Queue.unbounded<WorkerMessage>()

    function handleMessage(event: MessageEvent) {
      return parseMessage(event.data).pipe(
        Effect.tap(() =>
          Effect.logDebug('Received message from worker', {
            workerId: handle.id
          })
        ),
        Effect.flatMap(
          (message) =>
            Queue.offer(
              inbox,
              WorkerMessage.make({
                message,
                workerId: handle.id
              })
            )
        ),
        Effect.catchAll(
          () =>
            Deferred.fail(
              crashed,
              new WorkerDeserializationError({
                workerId: handle.id,
                event
              })
            )
        )
      )
    }

    function handleError(event: ErrorEvent) {
      return Deferred.fail(
        crashed,
        new WorkerCrashedError({
          workerId: handle.id,
          event
        })
      )
    }

    function handleMessageError(event: MessageEvent) {
      return Deferred.fail(
        crashed,
        new WorkerDeserializationError({
          workerId: handle.id,
          event
        })
      )
    }

    yield* Effect.sync(
      () => {
        handle.worker.onmessage = (event) =>
          Effect.runSync(
            handleMessage(event)
          )

        handle.worker.onerror = (event) => {
          event.preventDefault()
          Effect.runSync(
            handleError(event)
          )
        }

        handle.worker.onmessageerror = (event) => {
          event.preventDefault()
          Effect.runSync(
            handleMessageError(event)
          )
        }
      }
    )

    yield* Effect.logDebug('Worker handlers attached', {
      workerId: handle.id
    })

    return { inbox, crashed } as const
  })
}

function superviseWorker(
  {
    givenRuntimePermissions,
    id,
    status,
    pluginManifest,
    scope,
    handlesRef,
    ps
  }: SuperviseWorkerOptions
) {
  return Effect.gen(function* () {
    yield* Effect.logDebug('Acquiring worker', {
      workerId: id,
      pluginId: pluginManifest.id
    })

    const worker = yield* acquireWorker({
      givenRuntimePermissions,
      pluginManifest
    })

    yield* Effect.log(`Worker ${id} acquired and started`)

    yield* Effect.logDebug('Setting up worker', {
      workerId: id,
      pluginId: pluginManifest.id
    })

    const { inbox, crashed } = yield* setupWorker({
      givenRuntimePermissions,
      id,
      pluginManifest,
      worker
    })

    yield* Effect.logDebug('Worker setup complete', {
      workerId: id
    })

    const workerHandle: WorkerHandle = {
      givenRuntimePermissions,
      id,
      pluginManifest,
      scope,
      status,
      worker
    }

    yield* Ref.update(handlesRef, HashMap.set(workerHandle.id, workerHandle))
    yield* Ref.set(workerHandle.status, { _tag: 'Running' })

    yield* Effect.logDebug('Worker registered as Running', {
      workerId: id
    })

    yield* Queue.take(inbox).pipe(
      Effect.tap((msg) =>
        Effect.logDebug('Publishing message to PubSub', {
          workerId: id,
          event: msg.message.event
        })
      ),
      Effect.flatMap(
        (msg) => PubSub.publish(ps, msg)
      ),
      Effect.forever,
      Effect.forkScoped
    )

    yield* Effect.logDebug('Awaiting worker crash or termination signal', {
      workerId: id
    })

    yield* Deferred.await(crashed)

    yield* Effect.logDebug('Worker crash signal received', {
      workerId: id
    })
  }).pipe(
    Effect.annotateLogs({
      workerId: id,
      pluginId: pluginManifest.id
    }),
    Effect.withLogSpan('superviseWorker'),
    Scope.extend(scope),
    Effect.retry(
      Schedule.exponential('100 millis').pipe(
        Schedule.intersect(Schedule.recurs(5))
      )
    ),
    Effect.onExit(
      (exit) =>
        Effect.gen(function* () {
          yield* Effect.logDebug('Supervisor handling worker exit', {
            exitTag: exit._tag
          })

          if (Exit.isSuccess(exit)) {
            yield* Ref.set(status, { _tag: 'Terminated' })
          } else if (Exit.isInterrupted(exit)) {
            yield* Ref.set(status, { _tag: 'Interrupted' })
          } else {
            yield* Ref.set(status, {
              _tag: 'Crashed',
              error: Cause.squash(exit.cause)
            })
          }

          yield* Scope.close(scope, Exit.void)
        })
    )
  )
}

export class Supervisor extends Effect.Service<Supervisor>()(
  'Supervisor',
  {
    scoped: Effect.gen(function* () {
      const fibers = yield* FiberMap.make<WorkerId>()
      const handlesRef = yield* Ref.make(
        HashMap.empty<WorkerId, WorkerHandle>()
      )

      yield* Effect.logDebug('Supervisor initialized')

      function start(options: StartWorkerOptions) {
        return Effect.gen(function* () {
          yield* Effect.logDebug('Starting worker', {
            pluginId: options.pluginManifest.id
          })

          const id = WorkerId.make(crypto.randomUUID())
          const status = yield* Ref.make<WorkerStatus>({ _tag: 'Running' })
          const scope = yield* Scope.make()

          yield* Effect.logDebug('Created worker scope', {
            workerId: id
          })

          const fiber = yield* FiberMap.run(
            fibers,
            id,
            superviseWorker(
              {
                ...options,
                id,
                scope,
                status,
                handlesRef
              }
            )
          )

          yield* Effect.log(`Started fiber for worker ${id}`, {
            id,
            fiber: fiber.status
          })

          return { id, fiber, status }
        }).pipe(Effect.withLogSpan('supervisor.start'))
      }

      function interrupt(id: WorkerId) {
        return Effect.gen(function* () {
          yield* Effect.logDebug('Interrupting worker', { workerId: id })

          const handle = yield* get(id)

          if (Option.isSome(handle)) {
            yield* Effect.logDebug('Removing worker fiber and handle', {
              workerId: id
            })
            yield* FiberMap.remove(fibers, id)
            yield* Ref.update(handlesRef, HashMap.remove(id))
            yield* Effect.logDebug('Worker interrupted and removed', {
              workerId: id
            })
          } else {
            yield* Effect.logDebug('Worker not found for interrupt', {
              workerId: id
            })
          }
        })
      }

      function get(id: WorkerId) {
        return Ref.get(handlesRef).pipe(
          Effect.tap(() =>
            Effect.logDebug('Looking up worker handle', { workerId: id })
          ),
          Effect.map(HashMap.get(id))
        )
      }

      return {
        start,
        interrupt,
        get
      } as const
    })
  }
) {}

type AcquireWorkerOptions = {
  pluginManifest: PluginManifest
  givenRuntimePermissions: RuntimePermission[]
}

type StartWorkerOptions = AcquireWorkerOptions & {
  ps: PubSub.PubSub<WorkerMessage>
}

type SuperviseWorkerOptions = Omit<WorkerHandle, 'worker'> & {
  ps: PubSub.PubSub<WorkerMessage>
  handlesRef: Ref.Ref<HashMap.HashMap<WorkerId, WorkerHandle>>
}

type WorkerId = typeof WorkerId.Type

type WorkerStatus = {
  _tag: 'Running'
} | {
  _tag: 'Terminated'
} | {
  _tag: 'Interrupted'
} | {
  _tag: 'Crashed'
  error: unknown
}

type WorkerHandle = {
  id: WorkerId
  worker: Worker
  pluginManifest: PluginManifest
  givenRuntimePermissions: RuntimePermission[]
  scope: Scope.CloseableScope
  status: Ref.Ref<WorkerStatus>
}
