import {
  Context,
  Data,
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  PubSub,
  Queue,
  Scope
} from 'effect'
import { Supervisor, type WorkerLifecycleEvent } from './supervisor.ts'
import type { WorkerId } from './workerId.ts'
import {
  type PluginPermissionUpdate,
  PluginRegistry
} from './pluginRegistry.ts'
import {
  type HookDispatchPayload,
  type HookResultPayload,
  Message,
  ProtocolEvent,
  type RpcRequestPayload,
  type SerializedError,
  type WorkerMessage
} from './protocol.ts'
import type { RuntimePermission } from './runtimePermission.ts'
import { ItemNotFoundError, Storage, StorageError } from './storage.ts'
import type { Host } from './host.ts'
import type { InstallPlugin, PluginMetadata } from './plugin.ts'
import {
  type Permission,
  permissionKey,
  requirePermissions
} from './permission.ts'
import { $call } from './rpc.ts'
import type { Event } from './event.ts'
import { $validate } from './validation.ts'

export class HostDefinition extends Context.Tag('HostDefinition')<
  HostDefinition,
  Host<any>
>() {}

export class HostRpcNotFoundError
  extends Data.TaggedError('HostRpcNotFoundError')<{
    rpc: string
  }> {}

export class HookDispatchTimedOutError
  extends Data.TaggedError('HookDispatchTimedOutError')<{
    workerId: WorkerId
    event: string
    requestId: string
  }> {}

export class HookDispatchFailedError
  extends Data.TaggedError('HookDispatchFailedError')<{
    workerId: WorkerId
    event: string
    requestId: string
    error: SerializedError
  }> {}

const hookDispatchTimeout = '3 seconds'

export function ephemeralStorage(): AsyncStorageImpl {
  const store = new Map<string, unknown>()

  return {
    get: (key: string) => Promise.resolve(store.get(key)),
    set: (key: string, value: unknown) => {
      store.set(key, value)
      return Promise.resolve()
    }
  }
}

export function engine<H extends Host<any>>(
  options: EngineOptions<H>
): EngineInstance<H> {
  const storage = Storage.of({
    get: (key: string) =>
      Effect.tryPromise({
        try: () => options.storage.get(key),
        catch: (cause) => new StorageError({ cause })
      }).pipe(
        Effect.filterOrFail((result) => result !== undefined, () =>
          new ItemNotFoundError({ key }))
      ),
    set: (key: string, value: unknown) =>
      Effect.tryPromise({
        try: () => options.storage.set(key, value),
        catch: (cause) => new StorageError({ cause })
      })
  })

  const layers = Engine.Default.pipe(
    Layer.provide(Supervisor.Default),
    Layer.provide(PluginRegistry.Default),
    Layer.provide(Layer.succeed(Storage, storage)),
    Layer.provide(Layer.succeed(HostDefinition, options.host))
  )

  const scope = Effect.runPromise(Scope.make())
  const context = scope.then((scope) =>
    Effect.runPromise(Layer.buildWithScope(layers, scope))
  )

  const run = async <A>(effect: Effect.Effect<A, any, Engine>) => {
    const builtContext = await context

    return await Effect.runPromise(
      effect.pipe(
        Effect.provide(builtContext),
        Effect.orDie
      )
    )
  }

  const start = () =>
    run(Engine.pipe(
      Effect.flatMap((engine) => engine.start())
    ))

  const install = (plugin: InstallPlugin) =>
    run(
      Engine.pipe(
        Effect.flatMap((engine) => engine.install(plugin))
      )
    )

  const grantHostPermission = (
    pluginId: string,
    permission: Permission | string
  ) =>
    run(
      Engine.pipe(
        Effect.flatMap((engine) =>
          engine.grantHostPermission(pluginId, permission)
        )
      )
    )

  const revokeHostPermission = (
    pluginId: string,
    permission: Permission | string
  ) =>
    run(
      Engine.pipe(
        Effect.flatMap((engine) =>
          engine.revokeHostPermission(pluginId, permission)
        )
      )
    )

  const grantRuntimePermission = (
    pluginId: string,
    permission: RuntimePermission
  ) =>
    run(
      Engine.pipe(
        Effect.flatMap((engine) =>
          engine.grantRuntimePermission(pluginId, permission)
        )
      )
    )

  const revokeRuntimePermission = (
    pluginId: string,
    permission: RuntimePermission
  ) =>
    run(
      Engine.pipe(
        Effect.flatMap((engine) =>
          engine.revokeRuntimePermission(pluginId, permission)
        )
      )
    )

  const hostPermissionKeys = options.host.permissions.map(permissionKey)

  const callHostRpc = (rpc: string, input: unknown) =>
    run(
      Engine.pipe(
        Effect.flatMap((engine) =>
          engine.callHostRpc(rpc, input, hostPermissionKeys)
        )
      )
    )

  const rpc = Object.fromEntries(
    Object.keys(options.host.rpc).map((key) => [
      key,
      (input: unknown) => callHostRpc(key, input)
    ])
  ) as H['$inferRPC']

  const emit = (event: Event<any>, payload: unknown) =>
    run(
      Engine.pipe(
        Effect.flatMap((engine) => engine.emitHostEvent(event, payload))
      )
    ).then(() => undefined)

  let stopped = false

  const stop = async () => {
    if (stopped) {
      return
    }

    stopped = true
    const closeScope = await scope
    await Effect.runPromise(Scope.close(closeScope, Exit.void))
  }

  return {
    start: () => start().then(() => undefined),
    install: (plugin: InstallPlugin) => install(plugin),
    grantHostPermission: (
      pluginId: string,
      permission: Permission | string
    ) => grantHostPermission(pluginId, permission),
    revokeHostPermission: (
      pluginId: string,
      permission: Permission | string
    ) => revokeHostPermission(pluginId, permission),
    grantRuntimePermission: (
      pluginId: string,
      permission: RuntimePermission
    ) => grantRuntimePermission(pluginId, permission),
    revokeRuntimePermission: (
      pluginId: string,
      permission: RuntimePermission
    ) => revokeRuntimePermission(pluginId, permission),
    emit,
    rpc,
    stop
  } as const
}

export class Engine extends Effect.Service<Engine>()(
  'Engine',
  {
    scoped: Effect.gen(function* () {
      const pluginRegistry = yield* PluginRegistry
      const supervisor = yield* Supervisor
      const host = yield* HostDefinition
      const workerMessages = yield* PubSub.unbounded<WorkerMessage>()
      const workerLifecycleEvents = yield* PubSub.unbounded<
        WorkerLifecycleEvent
      >()
      const workerMessageSubscription = yield* PubSub.subscribe(workerMessages)
      const readyWorkers = new Set<WorkerId>()
      const pendingHostMessages = new Map<WorkerId, typeof Message.Type[]>()
      const pendingHookDispatches = new Map<
        string,
        {
          deferred: Deferred.Deferred<void, HookDispatchError>
          event: string
          workerId: WorkerId
        }
      >()

      yield* Queue.take(workerMessageSubscription).pipe(
        Effect.flatMap((message) =>
          handleWorkerMessage(message).pipe(
            Effect.catchAll((error) =>
              Effect.logError('Failed to handle worker message', { error })
            ),
            Effect.forkScoped
          )
        ),
        Effect.forever,
        Effect.forkScoped
      )

      function dispatchOnInstall(
        workerId: WorkerId,
        pluginManifest: PluginMetadata
      ) {
        return dispatchHookToWorker(
          workerId,
          PluginRegistry.CONSTANTS.OnInstall,
          pluginManifest
        )
      }

      function dispatchOnStart(
        workerId: WorkerId,
        pluginManifest: PluginMetadata
      ) {
        return dispatchHookToWorker(
          workerId,
          PluginRegistry.CONSTANTS.OnStart,
          pluginManifest
        )
      }

      function dispatchHookToPlugin(
        pluginId: string,
        event: string,
        payload: unknown
      ) {
        return Effect.gen(function* () {
          const handle = yield* supervisor.getByPluginId(pluginId)

          if (Option.isNone(handle)) {
            return
          }

          yield* dispatchHookToWorker(handle.value.id, event, payload)
        })
      }

      function dispatchHookToWorker(
        workerId: WorkerId,
        event: string,
        payload: unknown
      ) {
        return Effect.gen(function* () {
          const requestId = crypto.randomUUID()
          const deferred = yield* Deferred.make<void, HookDispatchError>()
          const message = Message.make({
            id: requestId,
            event: ProtocolEvent.HookDispatch,
            payload: {
              event,
              payload
            } satisfies HookDispatchPayload
          })

          pendingHookDispatches.set(requestId, {
            deferred,
            event,
            workerId
          })

          if (!readyWorkers.has(workerId)) {
            const pending = pendingHostMessages.get(workerId) ?? []
            pending.push(message)
            pendingHostMessages.set(workerId, pending)
          } else {
            yield* supervisor.notify(workerId, message)
          }

          yield* Deferred.await(deferred).pipe(
            Effect.timeoutFail({
              duration: hookDispatchTimeout,
              onTimeout: () =>
                new HookDispatchTimedOutError({
                  workerId,
                  event,
                  requestId
                })
            }),
            Effect.ensuring(
              Effect.sync(() => {
                pendingHookDispatches.delete(requestId)
                removePendingHostMessage(workerId, requestId)
              })
            )
          )
        })
      }

      function removePendingHostMessage(workerId: WorkerId, requestId: string) {
        const pending = pendingHostMessages.get(workerId)

        if (pending === undefined) {
          return
        }

        const remaining = pending.filter((message) => message.id !== requestId)

        if (remaining.length === 0) {
          pendingHostMessages.delete(workerId)
        } else {
          pendingHostMessages.set(workerId, remaining)
        }
      }

      function markWorkerReady(workerId: WorkerId) {
        return Effect.gen(function* () {
          readyWorkers.add(workerId)

          const pending = pendingHostMessages.get(workerId) ?? []
          pendingHostMessages.delete(workerId)

          yield* Effect.forEach(
            pending,
            (message) => supervisor.notify(workerId, message),
            {
              discard: true
            }
          )
        })
      }

      function dispatchHostEvent(event: string, payload: unknown) {
        return Effect.gen(function* () {
          const plugins = yield* pluginRegistry.getInstalledPlugins()

          yield* Effect.forEach(
            plugins,
            (plugin) => dispatchHookToPlugin(plugin.id, event, payload),
            {
              concurrency: 'unbounded',
              discard: true
            }
          )
        })
      }

      function emitHostEvent(event: Event<any>, payload: unknown) {
        return $validate(event.payload, payload).pipe(
          Effect.flatMap((validatedPayload) =>
            dispatchHostEvent(event.key, validatedPayload)
          )
        )
      }

      function callHostRpc(
        rpcName: string,
        input: unknown,
        grantedHostPermissions: readonly string[]
      ) {
        return Effect.gen(function* () {
          const hostRpc = host.rpc[rpcName]

          if (hostRpc === undefined) {
            return yield* new HostRpcNotFoundError({ rpc: rpcName })
          }

          yield* requirePermissions(
            grantedHostPermissions,
            hostRpc.requiredPermissions
          )

          const emittedEvents: EmittedHostEvent[] = []
          const output = yield* $call(hostRpc as any, input as any, {
            emit: (event, payload) => {
              emittedEvents.push({ event, payload })
            }
          })

          yield* Effect.forEach(
            emittedEvents,
            ({ event, payload }) => emitHostEvent(event, payload),
            {
              discard: true
            }
          )

          return output
        })
      }

      function handleWorkerMessage(workerMessage: WorkerMessage) {
        if (workerMessage.message.event === ProtocolEvent.PluginReady) {
          return markWorkerReady(workerMessage.workerId)
        }

        if (workerMessage.message.event === ProtocolEvent.HookResult) {
          return handleHookResult(workerMessage)
        }

        if (workerMessage.message.event !== ProtocolEvent.RpcRequest) {
          return Effect.void
        }

        return Effect.gen(function* () {
          const payload = workerMessage.message.payload

          if (!isRpcRequestPayload(payload)) {
            yield* sendRpcResponse(
              workerMessage.workerId,
              workerMessage.message.id,
              {
                ok: false,
                error: {
                  name: 'InvalidRpcRequest',
                  message: 'Invalid RPC request payload'
                }
              }
            )
            return
          }

          const handle = yield* supervisor.get(workerMessage.workerId)

          if (Option.isNone(handle)) {
            return
          }

          const plugin = yield* pluginRegistry.getInstalledPlugin(
            handle.value.pluginManifest.id
          )

          yield* callHostRpc(
            payload.rpc,
            payload.input,
            plugin.grantedHostPermissions
          ).pipe(
            Effect.matchEffect({
              onFailure: (error) =>
                sendRpcResponse(
                  workerMessage.workerId,
                  workerMessage.message.id,
                  {
                    ok: false,
                    error: serializeError(error)
                  }
                ),
              onSuccess: (output) =>
                sendRpcResponse(
                  workerMessage.workerId,
                  workerMessage.message.id,
                  {
                    ok: true,
                    output
                  }
                )
            })
          )
        })
      }

      function handleHookResult(workerMessage: WorkerMessage) {
        const payload = workerMessage.message.payload

        if (!isHookResultPayload(payload)) {
          return Effect.void
        }

        const pending = pendingHookDispatches.get(payload.requestId)

        if (pending === undefined) {
          return Effect.void
        }

        if (payload.ok) {
          return Deferred.succeed(pending.deferred, undefined).pipe(
            Effect.asVoid
          )
        }

        return Deferred.fail(
          pending.deferred,
          new HookDispatchFailedError({
            workerId: pending.workerId,
            event: pending.event,
            requestId: payload.requestId,
            error: payload.error
          })
        ).pipe(Effect.asVoid)
      }

      function sendRpcResponse(
        workerId: WorkerId,
        requestId: string,
        response: {
          ok: true
          output: unknown
        } | {
          ok: false
          error: SerializedError
        }
      ) {
        return supervisor.notify(
          workerId,
          Message.make({
            id: crypto.randomUUID(),
            event: ProtocolEvent.RpcResponse,
            payload: {
              requestId,
              ...response
            }
          })
        )
      }

      function start() {
        return Effect.gen(function* () {
          const plugins = yield* pluginRegistry.getInstalledPlugins()

          yield* Effect.forEach(
            plugins,
            (plugin) =>
              supervisor.getByPluginId(plugin.id).pipe(
                Effect.flatMap((handle) => {
                  if (Option.isSome(handle)) {
                    return Effect.void
                  }

                  return supervisor.start({
                    pluginManifest: plugin,
                    grantedRuntimePermissions: plugin
                      .grantedRuntimePermissions as RuntimePermission[],
                    workerMessages,
                    workerLifecycleEvents
                  }).pipe(
                    Effect.flatMap(
                      (process) => dispatchOnStart(process.id, plugin)
                    )
                  )
                })
              ),
            {
              concurrency: 'unbounded',
              discard: true
            }
          )
        })
      }

      function install(plugin: InstallPlugin) {
        return Effect.gen(function* () {
          yield* pluginRegistry.installPlugin(plugin)

          const process = yield* supervisor.start({
            pluginManifest: plugin,
            grantedRuntimePermissions: plugin
              .grantedRuntimePermissions as RuntimePermission[],
            workerLifecycleEvents,
            workerMessages
          })
          yield* dispatchOnInstall(process.id, plugin).pipe(
            Effect.ensuring(supervisor.interrupt(process.id))
          )
        })
      }

      function restartRunningPlugin(plugin: InstallPlugin) {
        return Effect.gen(function* () {
          const handle = yield* supervisor.getByPluginId(plugin.id)

          if (Option.isNone(handle)) {
            return false
          }

          readyWorkers.delete(handle.value.id)
          pendingHostMessages.delete(handle.value.id)
          yield* supervisor.interrupt(handle.value.id)

          const process = yield* supervisor.start({
            pluginManifest: plugin,
            grantedRuntimePermissions: plugin
              .grantedRuntimePermissions as RuntimePermission[],
            workerLifecycleEvents,
            workerMessages
          })

          yield* dispatchOnStart(process.id, plugin)

          return true
        })
      }

      function grantHostPermission(
        pluginId: string,
        permission: Permission | string
      ) {
        return pluginRegistry.grantHostPermission(pluginId, permission)
      }

      function revokeHostPermission(
        pluginId: string,
        permission: Permission | string
      ) {
        return pluginRegistry.revokeHostPermission(pluginId, permission)
      }

      function grantRuntimePermission(
        pluginId: string,
        permission: RuntimePermission
      ) {
        return Effect.gen(function* () {
          const result = yield* pluginRegistry.grantRuntimePermission(
            pluginId,
            permission
          )

          if (!result.changed) {
            return { ...result, restarted: false }
          }

          const restarted = yield* restartRunningPlugin(result.plugin)

          return { ...result, restarted }
        })
      }

      function revokeRuntimePermission(
        pluginId: string,
        permission: RuntimePermission
      ) {
        return Effect.gen(function* () {
          const result = yield* pluginRegistry.revokeRuntimePermission(
            pluginId,
            permission
          )

          if (!result.changed) {
            return { ...result, restarted: false }
          }

          const restarted = yield* restartRunningPlugin(result.plugin)

          return { ...result, restarted }
        })
      }

      return {
        start,
        supervisor,
        pluginRegistry,
        install,
        grantHostPermission,
        revokeHostPermission,
        grantRuntimePermission,
        revokeRuntimePermission,
        callHostRpc,
        emitHostEvent
      } as const
    })
  }
) {
}

function isRpcRequestPayload(value: unknown): value is RpcRequestPayload {
  return typeof value === 'object' &&
    value !== null &&
    'rpc' in value &&
    typeof (value as { rpc: unknown }).rpc === 'string' &&
    'input' in value
}

function isHookResultPayload(value: unknown): value is HookResultPayload {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('requestId' in value) ||
    typeof (value as { requestId: unknown }).requestId !== 'string' ||
    !('ok' in value) ||
    typeof (value as { ok: unknown }).ok !== 'boolean'
  ) {
    return false
  }

  if ((value as { ok: boolean }).ok) {
    return true
  }

  return 'error' in value &&
    typeof (value as { error: unknown }).error === 'object' &&
    (value as { error: unknown }).error !== null &&
    'message' in (value as { error: object }).error
}

function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
    }
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    typeof (error as { _tag: unknown })._tag === 'string'
  ) {
    return {
      name: (error as { _tag: string })._tag,
      message: (error as { message?: string }).message ??
        (error as { _tag: string })._tag
    }
  }

  return {
    name: 'Error',
    message: String(error)
  }
}

type EmittedHostEvent = {
  event: Event<any>
  payload: unknown
}

type HookDispatchError =
  | HookDispatchTimedOutError
  | HookDispatchFailedError

type AsyncStorageImpl = {
  /**
   * Retrieves a value from storage by its key. Returns a promise that resolves
   * to the value, or undefined if the key does not exist.
   */
  get: (key: string) => Promise<unknown | undefined>

  /**
   * Stores a value in storage under the specified key. Returns a promise that
   * resolves when the value has been successfully stored.
   */
  set: (key: string, value: unknown) => Promise<void>
}

export type EngineInstance<H extends Host<any> = Host<any>> = {
  start: () => Promise<void>
  install: (plugin: InstallPlugin) => Promise<void>
  grantHostPermission: (
    pluginId: string,
    permission: Permission | string
  ) => Promise<PluginPermissionUpdate>
  revokeHostPermission: (
    pluginId: string,
    permission: Permission | string
  ) => Promise<PluginPermissionUpdate>
  grantRuntimePermission: (
    pluginId: string,
    permission: RuntimePermission
  ) => Promise<RuntimePermissionUpdate>
  revokeRuntimePermission: (
    pluginId: string,
    permission: RuntimePermission
  ) => Promise<RuntimePermissionUpdate>
  emit: (event: Event<any>, payload: unknown) => Promise<void>
  rpc: H['$inferRPC']
  stop: () => Promise<void>
}

export type RuntimePermissionUpdate = PluginPermissionUpdate & {
  restarted: boolean
}

export type EngineOptions<H extends Host<any>> = {
  /**
   * The host application.
   */
  host: H

  /**
   * An implementation of asynchronous storage that the engine can use to
   * persistdata across sessions. This storage implementation must provide `get`
   * and `set` methods that return promises, allowing the engine to store and
   * retrieve data as needed.
   */
  storage: AsyncStorageImpl
}
