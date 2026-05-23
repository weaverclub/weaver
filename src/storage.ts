import { Context, Data, type Effect } from 'effect'

export class ItemNotFoundError extends Data.TaggedError('ItemNotFoundError')<{
  readonly key: string
}> {}

export class StorageError extends Data.TaggedError('StorageError')<{
  readonly message: string
}> {}

export class Storage extends Context.Tag('Storage')<Storage, StorageImpl>() {}

type StorageImpl = {
  get: (key: string) => Effect.Effect<unknown, ItemNotFoundError | StorageError>
  set: (key: string, value: unknown) => Effect.Effect<void, StorageError>
}
