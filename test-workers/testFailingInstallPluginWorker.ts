import { onInstall, plugin, runPlugin } from '../mod.ts'

const failingPlugin = plugin<any>({
  id: 'failing-install-plugin',
  name: 'Failing Install Plugin',
  version: '1.0.0',
  supportedHostVersions: ['1.x'],
  requestedHostPermissions: [],
  hooks: [
    onInstall(() => {
      throw new Error('install failed')
    })
  ]
})

runPlugin(failingPlugin)
