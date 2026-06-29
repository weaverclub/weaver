import type { StandardSchemaV1 } from '@standard-schema/spec'
import { Data, Effect } from 'effect'
import type { Permission } from './permission.ts'
import type { Optional } from './types.ts'
import type {
  EmitFn,
  PostExecutionHook,
  PostFailureHook,
  PreExecutionHook,
  RpcHookPhase
} from './hook.ts'
import { getRpcHookPhase } from './hook.ts'
import { $validate } from './validation.ts'

const InvalidInputErrorBase = Data.TaggedError('InvalidInputError')<{
  issues: readonly StandardSchemaV1.Issue[]
}>

export class InvalidInputError extends InvalidInputErrorBase {}

const InvalidInputUnknownErrorBase = Data.TaggedError(
  'InvalidInputUnknownError'
)<{
  cause: unknown
}>

export class InvalidInputUnknownError extends InvalidInputUnknownErrorBase {}

const InvalidOutputErrorBase = Data.TaggedError('InvalidOutputError')<{
  issues: readonly StandardSchemaV1.Issue[]
}>

export class InvalidOutputError extends InvalidOutputErrorBase {}

const InvalidOutputUnknownErrorBase = Data.TaggedError(
  'InvalidOutputUnknownError'
)<{
  cause: unknown
}>

export class InvalidOutputUnknownError extends InvalidOutputUnknownErrorBase {}

const HandlerErrorBase = Data.TaggedError('HandlerError')<{
  cause: unknown
}>

export class HandlerError extends HandlerErrorBase {}

const RpcHookErrorBase = Data.TaggedError('RpcHookError')<{
  phase: RpcHookPhase
  cause: unknown
}>

export class RpcHookError extends RpcHookErrorBase {}

export function $call<
  Input extends StandardSchemaV1,
  Output extends StandardSchemaV1 | void
>(
  rpc: RPC<Input, Output>,
  input: StandardSchemaV1.InferInput<Input>,
  options: CallOptions = {}
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

    const emit = options.emit ?? (() => {})

    yield* runHooks(
      rpc.hooks,
      'preExecution',
      { emit, input: validatedInput }
    )

    const output = yield* Effect.tryPromise({
      try: () => Promise.resolve(rpc.handler(validatedInput)),
      catch: (cause) => new HandlerError({ cause })
    }).pipe(
      Effect.catchAll((error) =>
        runHooks(
          rpc.hooks,
          'postFailure',
          { emit, input: validatedInput, error: error.cause }
        ).pipe(Effect.andThen(() => Effect.fail(error)))
      )
    )

    if (rpc.output) {
      const validatedOutput = yield* $validate(rpc.output, output).pipe(
        Effect.catchTags({
          UnknownException: (cause) => new InvalidOutputUnknownError({ cause }),
          ValidationError: ({ issues }) => new InvalidOutputError({ issues })
        })
      )

      yield* runHooks(
        rpc.hooks,
        'postExecution',
        { emit, input: validatedInput, output: validatedOutput }
      )

      return validatedOutput
    }

    yield* runHooks(
      rpc.hooks,
      'postExecution',
      { emit, input: validatedInput, output: undefined }
    )
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

function runHooks(
  hooks: readonly RpcHook<any, any>[],
  phase: RpcHookPhase,
  ctx: unknown
) {
  return Effect.forEach(
    hooks,
    (hook) => {
      if (getRpcHookPhase(hook) !== phase) {
        return Effect.void
      }

      return Effect.tryPromise({
        try: () => Promise.resolve(hook(ctx as never)),
        catch: (cause) => new RpcHookError({ phase, cause })
      })
    },
    {
      discard: true
    }
  )
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
  | RpcHookError

type CallOptions = {
  emit?: EmitFn
}

type RpcHook<I extends StandardSchemaV1, O extends StandardSchemaV1 | void> =
  | PreExecutionHook<StandardSchemaV1.InferOutput<I>>
  | PostExecutionHook<StandardSchemaV1.InferOutput<I>, ResolvedOutput<O>>
  | PostFailureHook<StandardSchemaV1.InferOutput<I>>
