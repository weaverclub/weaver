import { Schema } from 'effect'
import { WorkerId } from './supervisor.ts'

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

export const parseMessage = Schema.decodeUnknown(Message)

export type Message = typeof Message.Type
export type WorkerMessage = typeof WorkerMessage.Type
