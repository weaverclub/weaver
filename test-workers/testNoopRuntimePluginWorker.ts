import { plugin, runPlugin } from '../mod.ts'

const noopPlugin = plugin<any>({
  id: 'noop-runtime-plugin',
  name: 'Noop Runtime Plugin',
  version: '1.0.0',
  supportedHostVersions: ['1.x'],
  requestedHostPermissions: [],
  hooks: []
})

runPlugin(noopPlugin)
