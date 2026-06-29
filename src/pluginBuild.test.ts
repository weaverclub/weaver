import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { Effect } from 'effect'
import { analyzePluginSource, buildPluginPackage } from './pluginBuild.ts'

Deno.test('analyzePluginSource extracts metadata from plugin source', async () => {
  const source = `
    import { net, on, plugin } from 'weaver'
    import type { myHost } from './host.ts'
    import { taskPermission, afterCreateTask } from './api.ts'

    const myPlugin = plugin<typeof myHost>({
      id: 'my-plugin',
      name: 'My Plugin',
      version: '1.0.0',
      supportedHostVersions: ['1.x'],
      requestedHostPermissions: [taskPermission],
      requestedRuntimePermissions: [net(['api.example.com'])],
      hooks: [
        on(afterCreateTask, () => undefined)
      ]
    })
  `
  const tempDir = await Deno.makeTempDir()

  try {
    const apiPath = `${tempDir}/api.ts`
    const hostPath = `${tempDir}/host.ts`
    const pluginPath = `${tempDir}/plugin.ts`
    await Deno.writeTextFile(
      apiPath,
      `
      import { event, permission } from 'weaver'

      export const taskPermission = permission({
        key: 'manage tasks',
        description: 'Allows access to task-related features'
      })

      export const afterCreateTask = event({
        key: 'afterCreateTask',
        payload: undefined as any,
        description: 'Emitted after a task is created'
        })
      `
    )
    await Deno.writeTextFile(
      hostPath,
      `
      export const myHost = {}
    `
    )
    await Deno.writeTextFile(pluginPath, source)

    const result = await Effect.runPromise(
      analyzePluginSource(pluginPath, source, {
        metadataEntrypoint: './mod.js'
      })
    )

    assertEquals(result.pluginIdentifier, 'myPlugin')
    assertEquals(result.metadata, {
      id: 'my-plugin',
      name: 'My Plugin',
      version: '1.0.0',
      supportedHostVersions: ['1.x'],
      entrypoint: './mod.js',
      requestedHostPermissions: ['manage tasks'],
      requestedRuntimePermissions: [
        { type: 'net', urls: ['api.example.com'] }
      ]
    })
  } finally {
    await Deno.remove(tempDir, { recursive: true })
  }
})

Deno.test('buildPluginPackage emits one bundled package file and metadata JSON', async () => {
  const tempDir = await Deno.makeTempDir()

  try {
    await Deno.writeTextFile(
      `${tempDir}/deno.json`,
      JSON.stringify(
        {
          imports: {
            '@standard-schema/spec': 'jsr:@standard-schema/spec@1.1.0',
            effect: 'npm:effect@3.21.4',
            'fast-check': 'npm:fast-check@3.23.2',
            weaver: new URL('../mod.ts', import.meta.url).href,
            zod: 'npm:zod@^4.4.3'
          }
        },
        null,
        2
      )
    )
    await Deno.writeTextFile(
      `${tempDir}/api.ts`,
      `
      import { event, permission } from 'weaver'
      import { z } from 'zod'

      export const taskPermission = permission({
        key: 'manage tasks',
        description: 'Allows access to task-related features'
      })

      export const afterCreateTask = event({
        key: 'afterCreateTask',
        payload: z.object({
          taskId: z.string()
        }),
        description: 'Emitted after a task is created'
      })
    `
    )
    await Deno.writeTextFile(
      `${tempDir}/host.ts`,
      `
      import { host } from 'weaver'

      export const myHost = host({
        name: 'Test Host',
        version: '1.0.0',
        rpc: {},
        permissions: []
      })
    `
    )
    await Deno.writeTextFile(
      `${tempDir}/plugin.ts`,
      `
      import { on, plugin } from 'weaver'
      import type { myHost } from './host.ts'
      import { afterCreateTask, taskPermission } from './api.ts'

      const myPlugin = plugin<typeof myHost>({
        id: 'my-plugin',
        name: 'My Plugin',
        version: '1.0.0',
        supportedHostVersions: ['1.x'],
        requestedHostPermissions: [taskPermission],
        hooks: [
          on(afterCreateTask, (ctx) => {
            console.log(ctx.payload.taskId)
          })
        ]
      })
    `
    )

    const result = await Effect.runPromise(
      buildPluginPackage({
        source: `${tempDir}/plugin.ts`,
        outDir: `${tempDir}/dist`,
        config: `${tempDir}/deno.json`
      })
    )

    const metadata = JSON.parse(await Deno.readTextFile(result.metadataPath))
    const bundledSource = await Deno.readTextFile(result.packagePath)

    assertEquals(metadata, {
      id: 'my-plugin',
      name: 'My Plugin',
      version: '1.0.0',
      supportedHostVersions: ['1.x'],
      entrypoint: './mod.js',
      requestedHostPermissions: ['manage tasks'],
      requestedRuntimePermissions: []
    })
    assertStringIncludes(bundledSource, 'runPlugin(myPlugin)')
    assertStringIncludes(bundledSource, '__zod_globalRegistry')
    assert(!bundledSource.includes('Test Host'))
    assert(!bundledSource.includes(`from './api.ts'`))
    assert(!bundledSource.includes(`from 'zod'`))
  } finally {
    await Deno.remove(tempDir, { recursive: true })
  }
})
