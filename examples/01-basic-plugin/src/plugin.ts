import { on, plugin } from 'weaver'
import { afterCreateTask, manageTasks } from './api.ts'

const _myPlugin = plugin<any>({
  id: 'my-plugin',
  name: 'My Plugin',
  version: '1.0.0',
  requestedHostPermissions: [manageTasks],
  requestedRuntimePermissions: [],
  supportedHostVersions: ['1.x'],
  hooks: [
    on(afterCreateTask, async (ctx) => {
      const task = await ctx.rpc.getTask({
        taskId: ctx.payload.taskId
      })

      console.log('Task created:', task)
    })
  ]
})
