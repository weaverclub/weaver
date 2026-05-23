import { Schema } from 'effect'

export const Message = Schema.Struct({
  id: Schema.UUID.pipe(
    Schema.brand('MessageID')
  ),
  event: Schema.String,
  payload: Schema.Unknown
})

export const parseMessage = Schema.decodeUnknown(Message)

export type Message = typeof Message.Type
