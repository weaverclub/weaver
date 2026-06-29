import { Schema } from 'effect'
import { WorkerId } from './workerId.ts'

export const Message = Schema.Struct({
  id: Schema.UUID,
  event: Schema.String,
  payload: Schema.Unknown
})

/**
 * The worker shouldn't be aware of it's own ID otherwise they could send
 * messages with fake IDs which would be a security issue. The supervisor will
 * attach the worker ID to the message before broadcasting it to the rest of the
 * system.
 */
export const WorkerMessage = Schema.Struct({
  workerId: WorkerId,
  message: Message
})

export const LifecycleEvent = {
  OnInstall: '__weaver_lifecycle_on_install__',
  OnStart: '__weaver_lifecycle_on_start__'
} as const

export const ProtocolEvent = {
  PluginReady: '__weaver_plugin_ready__',
  HookDispatch: '__weaver_hook_dispatch__',
  HookResult: '__weaver_hook_result__',
  RpcRequest: '__weaver_rpc_request__',
  RpcResponse: '__weaver_rpc_response__',
  HookError: '__weaver_hook_error__'
} as const

export const parseMessage = Schema.decodeUnknown(Message)

export type Message = typeof Message.Type
export type WorkerMessage = typeof WorkerMessage.Type

export type HookDispatchPayload = {
  event: string
  payload: unknown
}

export type HookResultPayload = {
  requestId: string
  ok: true
} | {
  requestId: string
  ok: false
  error: SerializedError
}

export type RpcRequestPayload = {
  rpc: string
  input: unknown
}

export type RpcResponsePayload = {
  requestId: string
  ok: true
  output: unknown
} | {
  requestId: string
  ok: false
  error: SerializedError
}

export type SerializedError = {
  name: string
  message: string
}
