import {
  engine,
  ephemeralStorage,
  event,
  host,
  permission,
  postExecution,
  rpc
} from 'weaver'
import { z } from 'zod'

export const manageTasks = permission({
  key: 'manage tasks',
  description: 'Allows access to task-related features'
})

export const afterCreateTask = event({
  key: 'afterCreateTask',
  payload: z.object({
    taskId: z.string(),
    title: z.string()
  }),
  description: 'Emitted after a new task is created'
})

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

await myEngine.start()
