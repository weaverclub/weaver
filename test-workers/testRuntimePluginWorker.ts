import { event, on, plugin, runPlugin } from '../mod.ts'
import { Schema } from 'effect'

const taskEventPayload = Schema.standardSchemaV1(
  Schema.Struct({
    taskId: Schema.String,
    title: Schema.String,
    completed: Schema.Boolean
  })
)

const afterCreateTask = event({
  key: 'afterCreateTask',
  payload: taskEventPayload,
  description: 'Emitted after a task is created'
})

const runtimePlugin = plugin<any>({
  id: 'runtime-plugin',
  name: 'Runtime Plugin',
  version: '1.0.0',
  supportedHostVersions: ['1.x'],
  requestedHostPermissions: [],
  hooks: [
    on(afterCreateTask, async (ctx) => {
      await ctx.rpc.getTask({
        taskId: ctx.payload.taskId
      })
    })
  ]
})

runPlugin(runtimePlugin)
