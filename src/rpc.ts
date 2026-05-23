import type { StandardSchemaV1 } from '@standard-schema/spec'
import { Data, Effect } from 'effect'
import type { Permission } from './permission.ts'
import type { Optional } from './types.ts'
import type {
  PostExecutionHook,
  PostFailureHook,
  PreExecutionHook
} from './hook.ts'
import { $validate } from './validation.ts'

export class InvalidInputError extends Data.TaggedError('InvalidInputError')<{
  issues: readonly StandardSchemaV1.Issue[]
}> {}

export class InvalidInputUnknownError
  extends Data.TaggedError('InvalidInputUnknownError')<{
    cause: unknown
  }> {}

export class InvalidOutputError extends Data.TaggedError('InvalidOutputError')<{
  issues: readonly StandardSchemaV1.Issue[]
}> {}

export class InvalidOutputUnknownError
  extends Data.TaggedError('InvalidOutputUnknownError')<{
    cause: unknown
  }> {}

export class HandlerError extends Data.TaggedError('HandlerError')<{
  cause: unknown
}> {}

export function $call<
  Input extends StandardSchemaV1,
  Output extends StandardSchemaV1 | void
>(
  rpc: RPC<Input, Output>,
  input: StandardSchemaV1.InferInput<Input>
): Effect.Effect<
  ResolvedOutput<Output>,
  $callErrors
> {
  return Effect.gen(function* () {
    const validatedInput = yield* $validate(rpc.input, input).pipe(
      Effect.catchTags({
        UnknownException: (cause) => new InvalidInputUnknownError({ cause }),
        ValidationError: ({ issues }) => new InvalidInputError({ issues })
      })
    )

    const output = yield* Effect.tryPromise({
      try: () => Promise.resolve(rpc.handler(validatedInput)),
      catch: (cause) => new HandlerError({ cause })
    })

    if (rpc.output) {
      return yield* $validate(rpc.output, output).pipe(
        Effect.catchTags({
          UnknownException: (cause) => new InvalidOutputUnknownError({ cause }),
          ValidationError: ({ issues }) => new InvalidOutputError({ issues })
        })
      )
    }
  }) as Effect.Effect<ResolvedOutput<Output>, $callErrors>
}

export function rpc<
  Input extends StandardSchemaV1,
  Output extends StandardSchemaV1 | void = void
>(
  options: Optional<
    RPC<Input, Output>,
    'requiredPermissions' | 'hooks'
  >
): RPC<Input, Output> {
  const defaultOptions = {
    requiredPermissions: [] as Permission[],
    hooks: [] as RpcHook<Input, Output>[]
  }

  const mergedOptions = {
    ...defaultOptions,
    ...options
  }

  return mergedOptions
}

export type RPC<
  Input extends StandardSchemaV1 = StandardSchemaV1,
  Output extends StandardSchemaV1 | void = void
> = {
  /**
   * The input schema for the RPC, used for validating the input data.
   *
   * You can use Zod, ArkType, or any other library that can produce a schema
   * compatible with the Standard Schema v1 specification.
   *
   * @see https://standardschema.dev/schema
   */
  input: Input

  /**
   * The output schema for the RPC, used for validating the output data.
   *
   * You can use Zod, ArkType, or any other library that can produce a schema
   * compatible with the Standard Schema v1 specification.
   *
   * @see https://standardschema.dev/schema
   */
  output?: Output

  /**
   * The handler function for the RPC, which will be called when the RPC is
   * invoked.
   *
   * The handler function receives the validated input data and should return
   * the output data. If the output schema is void, the handler function can
   * return void or a Promise that resolves to void.
   */
  handler: Output extends StandardSchemaV1 ? (
      input: StandardSchemaV1.InferOutput<Input>
    ) =>
      | Promise<StandardSchemaV1.InferInput<Output>>
      | StandardSchemaV1.InferInput<Output>
    : (input: StandardSchemaV1.InferOutput<Input>) => void

  /**
   * The permissions required to call this RPC. The host can use this
   * information to determine whether to allow the plugin to call the RPC based
   * on the permissions granted to the plugin.
   */
  requiredPermissions: Permission[]

  /**
   * Side-effect hooks that will be executed on the lifecycle of the RPC
   * execution.
   */
  hooks: RpcHook<Input, Output>[]
}

type ResolvedOutput<O extends StandardSchemaV1 | void> = O extends
  StandardSchemaV1 ? StandardSchemaV1.InferOutput<O> : void

type $callErrors =
  | InvalidInputError
  | InvalidInputUnknownError
  | InvalidOutputError
  | InvalidOutputUnknownError
  | HandlerError

type RpcHook<I extends StandardSchemaV1, O extends StandardSchemaV1 | void> =
  | PreExecutionHook<StandardSchemaV1.InferOutput<I>>
  | PostExecutionHook<StandardSchemaV1.InferOutput<I>, ResolvedOutput<O>>
  | PostFailureHook<StandardSchemaV1.InferOutput<I>>
