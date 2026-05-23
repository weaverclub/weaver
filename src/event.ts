import type { StandardSchemaV1 } from '@standard-schema/spec'

export function event<Payload extends StandardSchemaV1>(
  options: Event<Payload>
): Event<Payload> {
  return options
}

export type Event<Payload extends StandardSchemaV1> = {
  /**
   * The name of the event. This should be a string in kebab-case format (e.g.,
   * "after-greet", "on-startup").
   */
  key: string

  /**
   * A brief description of the event. This should provide enough information for
   * plugin developers to understand when this event is fired and what it is
   * used for.
   */
  description: string

  /**
   * The schema for the event payload. This should be a Zod schema that defines
   * the structure of the data that will be passed to plugins when this event is
   * fired.
   */
  payload: Payload
}
