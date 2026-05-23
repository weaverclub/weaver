import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { RPC } from './rpc.ts'
import type { Permission } from './permission.ts'
import type { Optional } from './types.ts'

export function host<
  RPCs extends Record<string, RPC<any, any>>
>(
  options: Optional<Omit<Host<RPCs>, '$inferRPC'>, 'permissions'>
): Host<RPCs> {
  const defaultOptions = {
    permissions: [] as Permission[]
  }

  const mergedOptions = {
    ...defaultOptions,
    ...options,
    $inferRPC: undefined as unknown as InferRPC<RPCs>
  }

  return mergedOptions
}

export type Host<
  RPCs extends Record<string, RPC<any, any>>
> = {
  /**
   * The name of the host, used for logging and debugging purposes.
   *
   * Usually the name of the application or service.
   */
  name: string

  /**
   * The version of the host.
   */
  version: string

  /**
   * The RPCs that the host supports.
   */
  rpc: RPCs

  /**
   * All permissions available in the host. This is used for validating
   * permissions required by RPCs and for providing a list of permissions to
   * plugin developers.
   */
  permissions: Permission[]

  /**
   * A type-level property that infers the types of the RPCs supported by the
   * host.
   */
  $inferRPC: InferRPC<RPCs>
}

export type InferRPC<RPCs extends Record<string, RPC<any, any>>> = {
  [K in keyof RPCs]: RPCs[K] extends RPC<infer Input, infer Output>
    ? FireEvent<Input, Output>
    : never
}

type FireEvent<
  Input extends StandardSchemaV1,
  Output extends StandardSchemaV1 | void = void
> = Output extends StandardSchemaV1 ? (
    input: StandardSchemaV1.InferInput<Input>
  ) => Promise<StandardSchemaV1.InferOutput<Output>>
  : (input: StandardSchemaV1.InferInput<Input>) => void
