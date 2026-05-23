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
import { type Message, parseMessage } from './protocol.ts'

const WorkerId = Schema.UUID.pipe(Schema.brand('WorkerId'))
const WorkerURL = Schema.URL.pipe(Schema.brand('WorkerURL'))

const parseWorkerURL = Schema.decodeUnknown(WorkerURL)

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
  return parseWorkerURL(pluginManifest.path).pipe(
    Effect.map((url) =>
      new Worker(url, {
        type: 'module',
        deno: {
          permissions: toDenoPermission(givenRuntimePermissions)
        }
      })
    ),
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
    const crashed = yield* Deferred.make<
      never,
      WorkerCrashedError | WorkerDeserializationError
    >()
    const inbox = yield* Queue.unbounded<Message>()

    function handleMessage(event: MessageEvent) {
      return parseMessage(event.data).pipe(
        Effect.flatMap(
          (msg) => Queue.offer(inbox, msg)
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

        handle.worker.onerror = (event) =>
          Effect.runSync(
            handleError(event)
          )

        handle.worker.onmessageerror = (event) =>
          Effect.runSync(
            handleMessageError(event)
          )
      }
    )

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
    const worker = yield* acquireWorker({
      givenRuntimePermissions,
      pluginManifest
    })

    yield* Effect.log(`Worker ${id} acquired and started`, worker)

    const { inbox, crashed } = yield* setupWorker({
      givenRuntimePermissions,
      id,
      pluginManifest,
      worker
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

    yield* Queue.take(inbox).pipe(
      Effect.flatMap(
        (msg) => PubSub.publish(ps, msg)
      ),
      Effect.forever,
      Effect.forkScoped
    )

    yield* Deferred.await(crashed)
  }).pipe(
    Scope.extend(scope),
    Effect.retry(
      Schedule.exponential('100 millis').pipe(
        Schedule.intersect(Schedule.recurs(5))
      )
    ),
    Effect.onExit(
      (exit) =>
        Effect.gen(function* () {
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

      function start(options: StartWorkerOptions) {
        return Effect.gen(function* () {
          const id = WorkerId.make(crypto.randomUUID())
          const status = yield* Ref.make<WorkerStatus>({ _tag: 'Running' })
          const scope = yield* Scope.make()

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

          fiber.addObserver((exit) => {
            console.log(`Worker ${id} exited with`, exit)
          })

          yield* Effect.log(`Started fiber for worker ${id}`, {
            id,
            fiber: fiber.status
          })

          return { id, fiber, status }
        })
      }

      function interrupt(id: WorkerId) {
        return Effect.gen(function* () {
          const handle = yield* get(id)

          if (Option.isSome(handle)) {
            yield* FiberMap.remove(fibers, id)
            yield* Ref.update(handlesRef, HashMap.remove(id))
          }
        })
      }

      function get(id: WorkerId) {
        return Ref.get(handlesRef).pipe(Effect.map(HashMap.get(id)))
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
  ps: PubSub.PubSub<Message>
}

type SuperviseWorkerOptions = Omit<WorkerHandle, 'worker'> & {
  ps: PubSub.PubSub<Message>
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
