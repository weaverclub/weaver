import type { StandardSchemaV1 } from '@standard-schema/spec'
import { Data, Effect } from 'effect'

export class ValidationError extends Data.TaggedError('ValidationError')<{
  issues: readonly StandardSchemaV1.Issue[]
}> {}

export function $validate<Input extends StandardSchemaV1>(
  schema: Input,
  data: unknown
) {
  return Effect.tryPromise(() =>
    Promise.resolve(
      schema['~standard'].validate(data)
    )
  ).pipe(
    Effect.filterOrFail(
      (result) => !result.issues,
      (result) => new ValidationError({ issues: result.issues })
    ),
    Effect.map((result) => result.value)
  )
}
