import { on, plugin } from 'weaver'
import { afterCreateTask, manageTasks, type myHost } from './host.ts'

const myPlugin = plugin<typeof myHost>({
  id: 'my-plugin',
  name: 'My Plugin',
  version: '1.0.0',
  requestPermissions: [manageTasks],
  supportedVersions: ['1.x'],
  hooks: [
    on(afterCreateTask, async (ctx) => {
      const task = await ctx.rpc.getTask({
        taskId: ctx.payload.taskId
      })

      console.log('Task created:', task)
    })
  ]
})
