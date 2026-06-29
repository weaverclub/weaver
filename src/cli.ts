#!/usr/bin/env -S deno run --allow-all

import { Args, Command, Options } from '@effect/cli'
import { NodeContext, NodeRuntime } from '@effect/platform-node'
import { Effect } from 'effect'
import { type BuildPluginOptions, buildPluginPackage } from './pluginBuild.ts'

const buildCommand = Command.make(
  'build',
  {
    source: Args.file({
      name: 'plugin',
      exists: 'yes'
    }),
    outDir: Options.directory('out-dir').pipe(
      Options.withDefault('dist'),
      Options.withDescription('Directory for generated package and metadata')
    ),
    packageFile: Options.text('package-file').pipe(
      Options.withDefault('mod.js'),
      Options.withDescription('Generated bundled Deno package file name')
    ),
    metadataFile: Options.text('metadata-file').pipe(
      Options.withDefault('plugin.json'),
      Options.withDescription('Generated plugin metadata JSON file name')
    ),
    entrypoint: Options.text('entrypoint').pipe(
      Options.optional,
      Options.withDescription('Entrypoint stored in metadata')
    ),
    config: Options.file('config', { exists: 'yes' }).pipe(
      Options.optional,
      Options.withDescription('Deno config used for bundling')
    ),
    runtimeImport: Options.text('runtime-import').pipe(
      Options.withDefault('weaver'),
      Options.withDescription('Import specifier used for the runtime bridge')
    )
  },
  (options) => {
    const buildOptions: BuildPluginOptions = {
      source: options.source,
      outDir: options.outDir,
      packageFile: options.packageFile,
      metadataFile: options.metadataFile,
      runtimeImport: options.runtimeImport
    }

    if (options.entrypoint._tag === 'Some') {
      buildOptions.metadataEntrypoint = options.entrypoint.value
    }

    if (options.config._tag === 'Some') {
      buildOptions.config = options.config.value
    }

    return buildPluginPackage(buildOptions).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          console.log(`Built plugin package: ${result.packagePath}`)
          console.log(`Wrote plugin metadata: ${result.metadataPath}`)
        })
      ),
      Effect.asVoid,
      Effect.orDie
    )
  }
).pipe(
  Command.withDescription(
    'Build a plugin source file into one bundled Deno package file and metadata JSON'
  )
)

const command = Command.make('weaver').pipe(
  Command.withSubcommands([buildCommand]),
  Command.withDescription('Weaver development tools')
)

const cli = Command.run(command, {
  name: 'Weaver CLI',
  version: '0.0.0'
})

cli([Deno.execPath(), 'weaver', ...Deno.args]).pipe(
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain
)
