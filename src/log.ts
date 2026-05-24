import { Effect, LogLevel, Logger } from 'effect'

export const isDebugEnabled = Boolean(Deno.env.get('WEAVER_DEBUG'))

export const logLevel = isDebugEnabled ? LogLevel.Debug : LogLevel.Info

export const LoggerLayer = Logger.pretty

export const MinimumLogLevelLayer = Logger.minimumLogLevel(logLevel)

export function runWithLogging<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(LoggerLayer),
      Effect.provide(MinimumLogLevelLayer)
    )
  )
}
