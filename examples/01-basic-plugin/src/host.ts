import {
  engine,
  ephemeralStorage,
  host,
  InstalledPlugin,
  postExecution,
  rpc
} from 'weaver'
import { z } from 'zod'
import { afterCreateTask, manageTasks } from './api.ts'

const getTask = rpc({
  input: z.object({
    taskId: z.string()
  }),
  output: z.object({
    taskId: z.string(),
    title: z.string(),
    completed: z.boolean()
  }),
  handler: ({ taskId }) => {
    return {
      taskId,
      title: 'Example Task',
      completed: false
    }
  },
  requiredPermissions: [manageTasks]
})

const createTask = rpc({
  input: z.object({
    title: z.string()
  }),
  output: z.object({
    taskId: z.string(),
    title: z.string(),
    completed: z.boolean()
  }),
  handler: ({ title }) => {
    return {
      taskId: 'task-1',
      title,
      completed: false
    }
  },
  hooks: [
    postExecution((ctx) => {
      ctx.emit(afterCreateTask, ctx.output)
    })
  ],
  requiredPermissions: [manageTasks]
})

export const myHost = host({
  name: 'My App',
  version: '1.0.0',
  rpc: {
    getTask,
    createTask
  },
  permissions: [
    manageTasks
  ]
})

const myEngine = engine({
  host: myHost,
  storage: ephemeralStorage()
})

const metadataUrl = new URL('../dist/plugin.json', import.meta.url)
const metadata = JSON.parse(await Deno.readTextFile(metadataUrl))

await myEngine.install(InstalledPlugin.make({
  ...metadata,
  entrypoint: new URL(metadata.entrypoint, metadataUrl).href,
  grantedHostPermissions: ['manage tasks'],
  grantedRuntimePermissions: []
}))

await myEngine.start()
await myEngine.rpc.createTask({ title: 'Ship plugin builder' })
await myEngine.stop()
