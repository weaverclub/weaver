import { event, permission } from 'weaver'
import { z } from 'zod'

export const manageTasks = permission({
  key: 'manage tasks',
  description: 'Allows access to task-related features'
})

export const afterCreateTask = event({
  key: 'afterCreateTask',
  payload: z.object({
    taskId: z.string(),
    title: z.string(),
    completed: z.boolean()
  }),
  description: 'Emitted after a new task is created'
})
