import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { Event } from './event.ts'
import type { InferRPC } from './host.ts'

/**
 * The `onInstall` hook is triggered when a plugin is installed in the host.
 * This allows the plugin to perform any necessary setup or initialization tasks
 * when it is first added to the host. The handler function receives a context
 * object that includes the RPC methods available in the host and a logger for
 * logging messages.
 *
 * @param handler - The function that will be called when the plugin is
 * installed. It receives a context object with the available RPC methods and a
 * logger.
 * @returns A hook object that can be included in the plugin's hooks array.
 */
export function onInstall<
  RPCs extends InferRPC<any>
>(handler: HandlerHook<RPCs, never>): Hook<'on-install', RPCs, never> {
  return {
    event: 'on-install' as const,
    handler
  }
}

export function on<
  RPCs extends InferRPC<any>,
  Payload extends StandardSchemaV1 | never
>(
  event: Event<Payload>,
  handler: HandlerHook<RPCs, Payload>
): Hook<string, RPCs, Payload> {
  return {
    event: event.key,
    handler
  }
}

export type Hook<
  Key extends string,
  RPCs extends InferRPC<any>,
  Payload extends StandardSchemaV1 | never = never
> = {
  /**
   * The name of the event that the hook listens for. This should be a string in
   * kebab-case format (e.g., "on-startup", "on-shutdown").
   */
  event: Key

  /**
   * The handler function that will be called when the specified event occurs.
   * The handler receives a context object that includes the RPC methods
   * available in the host and a logger for logging messages.
   */
  handler: HandlerHook<RPCs, Payload>
}

/**
 * Function signature for emitting events from within a hook. Provided by the
 * host runtime, it lets hooks fire custom events that other parts of the
 * system (e.g., plugins) can listen to via `on()`.
 *
 * @param event - The event definition (from `event()`).
 * @param payload - The payload matching the event's schema.
 */
export type EmitFn = <Payload extends StandardSchemaV1>(
  event: Event<Payload>,
  payload: StandardSchemaV1.InferOutput<Payload>
) => void

/**
 * A hook that runs **before** the RPC handler executes. The handler receives
 * the validated input but no output (execution hasn't happened yet). Useful
 * for validation, logging, metrics, or modifying input-side state.
 *
 * The generic `Input` is inferred from context when placed in an RPC's hooks
 * array — you don't need to specify it manually.
 *
 * @example
 * ```ts
 * preExecution((ctx) => {
 *   ctx.input  // inferred as the RPC's input type
 * })
 * ```
 */
export type PreExecutionHook<Input> = (
  ctx: { emit: EmitFn; input: Input }
) => void | Promise<void>

/**
 * A hook that runs **after** the RPC handler completes successfully. The
 * handler receives both the validated input and the handler's output. Useful
 * for emitting events, logging results, or side-effects that depend on the
 * output.
 *
 * The generics `Input` and `Output` are inferred from context when placed in
 * an RPC's hooks array.
 *
 * @example
 * ```ts
 * postExecution((ctx) => {
 *   ctx.input   // inferred as the RPC's input type
 *   ctx.output  // inferred as the RPC's output type
 * })
 * ```
 */
export type PostExecutionHook<Input, Output> = (
  ctx: { emit: EmitFn; input: Input; output: Output }
) => void | Promise<void>

/**
 * A hook that runs **after** the RPC handler throws an error. The handler
 * receives the validated input and the thrown error. Useful for error
 * reporting, cleanup, or firing fallback events.
 *
 * The generic `Input` is inferred from context when placed in an RPC's hooks
 * array.
 *
 * @example
 * ```ts
 * postFailure((ctx) => {
 *   ctx.input  // inferred as the RPC's input type
 *   ctx.error  // the thrown value (unknown)
 * })
 * ```
 */
export type PostFailureHook<Input> = (
  ctx: { emit: EmitFn; input: Input; error: unknown }
) => void | Promise<void>

/**
 * Creates a pre-execution hook. This is an identity function that provides
 * type inference for the handler's context — pass the handler directly and
 * the `Input` type is inferred from the RPC's hooks array.
 *
 * Place the result in an RPC's `hooks` array alongside other hook types.
 *
 * @param handler - The function to run before the RPC executes.
 * @returns The same function, typed as `PreExecutionHook<Input>`.
 *
 * @example
 * ```ts
 * const myRpc = rpc({
 *   input: myInputSchema,
 *   output: myOutputSchema,
 *   handler: (input) => { ... },
 *   hooks: [
 *     preExecution((ctx) => {
 *       console.log("input:", ctx.input)
 *     })
 *   ]
 * })
 * ```
 */
export function preExecution<Input>(
  handler: PreExecutionHook<Input>
): PreExecutionHook<Input> {
  return handler
}

/**
 * Creates a post-execution hook. This is an identity function that provides
 * type inference for the handler's context — pass the handler directly and
 * the `Input` and `Output` types are inferred from the RPC's hooks array.
 *
 * Place the result in an RPC's `hooks` array alongside other hook types.
 *
 * @param handler - The function to run after the RPC succeeds.
 * @returns The same function, typed as `PostExecutionHook<Input, Output>`.
 *
 * @example
 * ```ts
 * const myRpc = rpc({
 *   input: myInputSchema,
 *   output: myOutputSchema,
 *   handler: (input) => { ... },
 *   hooks: [
 *     postExecution((ctx) => {
 *       console.log("result:", ctx.output)
 *     })
 *   ]
 * })
 * ```
 */
export function postExecution<Input, Output>(
  handler: PostExecutionHook<Input, Output>
): PostExecutionHook<Input, Output> {
  return handler
}

/**
 * Creates a post-failure hook. This is an identity function that provides
 * type inference for the handler's context — pass the handler directly and
 * the `Input` type is inferred from the RPC's hooks array.
 *
 * Place the result in an RPC's `hooks` array alongside other hook types.
 *
 * @param handler - The function to run after the RPC throws.
 * @returns The same function, typed as `PostFailureHook<Input>`.
 *
 * @example
 * ```ts
 * const myRpc = rpc({
 *   input: myInputSchema,
 *   handler: (input) => { ... },
 *   hooks: [
 *     postFailure((ctx) => {
 *       console.error("error:", ctx.error)
 *     })
 *   ]
 * })
 * ```
 */
export function postFailure<Input>(
  handler: PostFailureHook<Input>
): PostFailureHook<Input> {
  return handler
}

export type Logger = {
  /**
   * Logs an informational message. This can be used for general logging
   * purposes, such as indicating that a plugin has been installed or that a
   * certain action has been performed.
   *
   * @param messages - The messages to log. This can be a string or any number
   * of additional arguments that will be logged together.
   */
  info: (...messages: any[]) => void

  /**
   * Logs a warning message. This can be used to indicate potential issues or
   * important information that may require attention.
   *
   * @param messages - The messages to log. This can be a string or any number
   * of additional arguments that will be logged together.
   */
  warn: (...messages: any[]) => void

  /**
   * Logs an error message. This can be used to indicate errors or critical
   * issues that have occurred.
   *
   * @param messages - The messages to log. This can be a string or any number
   * of additional arguments that will be logged together.
   */
  error: (...messages: any[]) => void
}

export type HandlerHook<
  RPCs extends InferRPC<any>,
  Payload extends StandardSchemaV1 | never
> = (ctx: {
  rpc: RPCs
  log: Logger
  payload: Payload extends StandardSchemaV1
    ? StandardSchemaV1.InferOutput<Payload>
    : never
}) => void | Promise<void>
