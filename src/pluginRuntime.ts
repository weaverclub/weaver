import type { Host } from './host.ts'
import type { Plugin } from './plugin.ts'
import {
  type HookDispatchPayload,
  type HookResultPayload,
  LifecycleEvent,
  ProtocolEvent,
  type RpcRequestPayload,
  type RpcResponsePayload
} from './protocol.ts'

export function runPlugin<
  H extends Host<any>,
  P extends Plugin<H, any>
>(plugin: P): void {
  const hooks = plugin.hooks as RuntimeHook[]
  const pendingRpc = new Map<
    string,
    {
      resolve: (value: unknown) => void
      reject: (error: unknown) => void
    }
  >()

  const rpc = new Proxy({}, {
    get: (_target, property) => {
      if (typeof property !== 'string') {
        return undefined
      }

      return (input: unknown) =>
        new Promise((resolve, reject) => {
          const id = crypto.randomUUID()

          pendingRpc.set(id, { resolve, reject })

          postWorkerMessage(
            ProtocolEvent.RpcRequest,
            {
              rpc: property,
              input
            } satisfies RpcRequestPayload,
            id
          )
        })
    }
  }) as H['$inferRPC']

  async function dispatchToHooks(event: string, payload: unknown) {
    const hookEvent = normalizeHookEvent(event)
    const matchingHooks = hooks.filter((hook) => hook.event === hookEvent)

    for (const hook of matchingHooks) {
      await hook.handler({
        log: console,
        payload: payload as never,
        rpc
      })
    }
  }

  async function handleHostMessage(rawMessage: unknown) {
    if (!isWorkerRuntimeMessage(rawMessage)) {
      return
    }

    if (rawMessage.event === ProtocolEvent.RpcResponse) {
      handleRpcResponse(rawMessage.payload)
      return
    }

    if (rawMessage.event === ProtocolEvent.HookDispatch) {
      await handleHookDispatch(rawMessage)
    }
  }

  async function handleHookDispatch(message: WorkerRuntimeMessage) {
    if (!isHookDispatchPayload(message.payload)) {
      postWorkerMessage(
        ProtocolEvent.HookResult,
        {
          requestId: message.id,
          ok: false,
          error: {
            name: 'InvalidHookDispatch',
            message: 'Invalid hook dispatch payload'
          }
        } satisfies HookResultPayload
      )
      return
    }

    try {
      await dispatchToHooks(message.payload.event, message.payload.payload)
      postWorkerMessage(
        ProtocolEvent.HookResult,
        {
          requestId: message.id,
          ok: true
        } satisfies HookResultPayload
      )
    } catch (error) {
      postWorkerMessage(
        ProtocolEvent.HookResult,
        {
          requestId: message.id,
          ok: false,
          error: serializeError(error)
        } satisfies HookResultPayload
      )
    }
  }

  function handleRpcResponse(payload: unknown) {
    if (!isRpcResponsePayload(payload)) {
      return
    }

    const pending = pendingRpc.get(payload.requestId)

    if (pending === undefined) {
      return
    }

    pendingRpc.delete(payload.requestId)

    if (payload.ok) {
      pending.resolve(payload.output)
    } else {
      pending.reject(new Error(payload.error.message))
    }
  }

  workerGlobal.addEventListener('message', (event) => {
    void handleHostMessage(event.data).catch((error) => {
      postWorkerMessage(ProtocolEvent.HookError, {
        pluginId: plugin.id,
        error: serializeError(error)
      })
    })
  })

  postWorkerMessage(ProtocolEvent.PluginReady, {
    pluginId: plugin.id,
    hooks: hooks.map((hook) => hook.event)
  })
}

function normalizeHookEvent(event: string): string {
  switch (event) {
    case LifecycleEvent.OnInstall:
      return 'on-install'
    case LifecycleEvent.OnStart:
      return 'on-start'
    default:
      return event
  }
}

function postWorkerMessage(
  event: string,
  payload: unknown,
  id = crypto.randomUUID()
) {
  workerGlobal.postMessage({
    id,
    event,
    payload
  })
}

const workerGlobal = globalThis as unknown as WorkerGlobal

function isWorkerRuntimeMessage(value: unknown): value is WorkerRuntimeMessage {
  return typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'event' in value &&
    typeof (value as { event: unknown }).event === 'string'
}

function isHookDispatchPayload(
  value: unknown
): value is HookDispatchPayload {
  return typeof value === 'object' &&
    value !== null &&
    'event' in value &&
    typeof (value as { event: unknown }).event === 'string' &&
    'payload' in value
}

function isRpcResponsePayload(
  value: unknown
): value is RpcResponsePayload {
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
    return 'output' in value
  }

  return 'error' in value &&
    typeof (value as { error: unknown }).error === 'object' &&
    (value as { error: unknown }).error !== null &&
    'message' in (value as { error: object }).error
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
    }
  }

  return {
    name: 'Error',
    message: String(error)
  }
}

type WorkerRuntimeMessage = {
  id: string
  event: string
  payload: unknown
}

type RuntimeHook = {
  event: string
  handler: (ctx: any) => void | Promise<void>
}

type WorkerGlobal = {
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent) => void
  ) => void
  postMessage: (message: unknown) => void
}
