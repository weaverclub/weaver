import { Schema } from 'effect'

export const WorkerId = Schema.UUID.pipe(Schema.brand('WorkerId'))
export type WorkerId = typeof WorkerId.Type
