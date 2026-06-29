import { Effect } from 'effect'
import ts from 'typescript'
import { PluginMetadata } from './plugin.ts'
import type { RuntimePermission } from './runtimePermission.ts'

export function buildPluginPackage(
  options: BuildPluginOptions
): Effect.Effect<BuildPluginResult, PluginBuildError> {
  return Effect.gen(function* () {
    const sourcePath = yield* realPath(options.source)
    const outDir = options.outDir ?? 'dist'
    const packageFile = options.packageFile ?? 'mod.js'
    const metadataFile = options.metadataFile ?? 'plugin.json'
    const packagePath = joinPath(outDir, packageFile)
    const metadataPath = joinPath(outDir, metadataFile)

    const sourceText = yield* readTextFile(sourcePath)
    const analysis = yield* analyzePluginSource(sourcePath, sourceText, {
      metadataEntrypoint: options.metadataEntrypoint ?? `./${packageFile}`
    })

    yield* makeDir(outDir)

    const bundleOptions: BundlePluginOptions = {
      sourcePath,
      sourceText,
      pluginIdentifier: analysis.pluginIdentifier,
      packagePath,
      runtimeImport: options.runtimeImport ?? 'weaver'
    }

    if (options.config !== undefined) {
      bundleOptions.config = options.config
    }

    yield* bundlePluginSource(bundleOptions)
    yield* writeTextFile(
      metadataPath,
      `${JSON.stringify(analysis.metadata, null, 2)}\n`
    )

    return {
      metadata: analysis.metadata,
      packagePath,
      metadataPath
    }
  })
}

export function analyzePluginSource(
  sourcePath: string,
  sourceText: string,
  options: AnalyzePluginSourceOptions
): Effect.Effect<AnalyzePluginSourceResult, PluginBuildError> {
  const sourceFile = createSourceFile(sourcePath, sourceText)

  return Effect.gen(function* () {
    const permissionKeys = yield* collectPermissionKeys(sourceFile)

    return yield* Effect.try({
      try: () => {
        const pluginCall = findPluginCall(sourceFile)

        if (pluginCall === undefined) {
          throw new PluginBuildError(
            `Could not find a top-level variable initialized with plugin(...) in ${sourcePath}`
          )
        }

        const metadata = PluginMetadata.make({
          id: requiredString(pluginCall.options, 'id'),
          name: requiredString(pluginCall.options, 'name'),
          version: requiredString(pluginCall.options, 'version'),
          supportedHostVersions: requiredStringArray(
            pluginCall.options,
            'supportedHostVersions',
            'supportedVersions'
          ),
          entrypoint: options.metadataEntrypoint,
          requestedHostPermissions: extractPermissionKeys(
            pluginCall.options,
            permissionKeys
          ),
          requestedRuntimePermissions: extractRuntimePermissions(
            pluginCall.options
          )
        })

        return {
          pluginIdentifier: pluginCall.identifier,
          metadata
        }
      },
      catch: toPluginBuildError
    })
  })
}

export class PluginBuildError extends Error {
  override name = 'PluginBuildError'
}

function bundlePluginSource(
  options: BundlePluginOptions
): Effect.Effect<void, PluginBuildError> {
  const tempPath = `${options.sourcePath}.weaver-${crypto.randomUUID()}.ts`
  const tempSource = [
    options.sourceText,
    '',
    `import { runPlugin as __weaverRunPlugin } from ${
      JSON.stringify(options.runtimeImport)
    }`,
    `__weaverRunPlugin(${options.pluginIdentifier})`,
    ''
  ].join('\n')

  return writeTextFile(tempPath, tempSource).pipe(
    Effect.flatMap(() =>
      Effect.gen(function* () {
        const output = yield* denoBundle(buildBundleArgs(options, tempPath))

        if (!output.success) {
          return yield* Effect.fail(bundleFailure(output))
        }
      })
    ),
    Effect.ensuring(removeFileIfExists(tempPath))
  )
}

function collectPermissionKeys(
  sourceFile: ts.SourceFile,
  context: PermissionKeyCollectionContext = {
    cache: new Map(),
    visiting: new Set()
  }
): Effect.Effect<Map<string, string>, PluginBuildError> {
  return Effect.gen(function* () {
    const resolvedPath = yield* realPath(sourceFile.fileName)
    const cached = context.cache.get(resolvedPath)

    if (cached !== undefined) {
      return new Map(cached)
    }

    if (context.visiting.has(resolvedPath)) {
      return new Map()
    }

    context.visiting.add(resolvedPath)

    return yield* Effect.gen(function* () {
      const keys = yield* Effect.try({
        try: () => collectLocalPermissionKeys(sourceFile),
        catch: toPluginBuildError
      })

      for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement)) {
          continue
        }

        const moduleSpecifier = statement.moduleSpecifier
        const importClause = statement.importClause

        if (
          !ts.isStringLiteral(moduleSpecifier) ||
          !moduleSpecifier.text.startsWith('.') ||
          importClause?.isTypeOnly ||
          importClause?.namedBindings === undefined ||
          !ts.isNamedImports(importClause.namedBindings)
        ) {
          continue
        }

        const importedPath = yield* Effect.try({
          try: () =>
            resolveModulePath(sourceFile.fileName, moduleSpecifier.text),
          catch: toPluginBuildError
        })
        const importedText = yield* readTextFile(importedPath).pipe(
          Effect.catchAll(() => Effect.succeed(undefined))
        )

        if (importedText === undefined) {
          continue
        }

        const importedFile = createSourceFile(importedPath, importedText)
        const importedKeys = yield* collectPermissionKeys(
          importedFile,
          context
        )

        for (const element of importClause.namedBindings.elements) {
          if (element.isTypeOnly) {
            continue
          }

          const importedName = element.propertyName?.text ?? element.name.text
          const localName = element.name.text
          const key = importedKeys.get(importedName)

          if (key !== undefined) {
            keys.set(localName, key)
          }
        }
      }

      context.cache.set(resolvedPath, new Map(keys))

      return keys
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          context.visiting.delete(resolvedPath)
        })
      )
    )
  })
}

type PermissionKeyCollectionContext = {
  cache: Map<string, Map<string, string>>
  visiting: Set<string>
}

function collectLocalPermissionKeys(sourceFile: ts.SourceFile) {
  const keys = new Map<string, string>()

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue
    }

    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        declaration.initializer === undefined
      ) {
        continue
      }

      const initializer = unwrapExpression(declaration.initializer)

      if (!isNamedCall(initializer, 'permission')) {
        continue
      }

      const options = initializer.arguments[0]

      if (options !== undefined && ts.isObjectLiteralExpression(options)) {
        const key = optionalString(options, 'key')

        if (key !== undefined) {
          keys.set(declaration.name.text, key)
        }
      }
    }
  }

  return keys
}

function findPluginCall(sourceFile: ts.SourceFile) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue
    }

    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        declaration.initializer === undefined
      ) {
        continue
      }

      const initializer = unwrapExpression(declaration.initializer)

      if (!isNamedCall(initializer, 'plugin')) {
        continue
      }

      const options = initializer.arguments[0]

      if (options === undefined || !ts.isObjectLiteralExpression(options)) {
        throw new PluginBuildError(
          'plugin(...) must be called with an object literal'
        )
      }

      return {
        identifier: declaration.name.text,
        options
      }
    }
  }
}

function extractPermissionKeys(
  options: ts.ObjectLiteralExpression,
  permissionKeys: Map<string, string>
) {
  const permissions = optionalArray(
    options,
    'requestedHostPermissions',
    'requestPermissions'
  )

  if (permissions === undefined) {
    return []
  }

  return permissions.map((permission) => {
    if (ts.isStringLiteral(permission)) {
      return permission.text
    }

    if (ts.isIdentifier(permission)) {
      const key = permissionKeys.get(permission.text)

      if (key !== undefined) {
        return key
      }
    }

    throw new PluginBuildError(
      `Could not statically resolve host permission ${permission.getText()}`
    )
  })
}

function extractRuntimePermissions(
  options: ts.ObjectLiteralExpression
): RuntimePermission[] {
  const permissions = optionalArray(options, 'requestedRuntimePermissions')

  if (permissions === undefined) {
    return []
  }

  return permissions.map((permission) => extractRuntimePermission(permission))
}

function extractRuntimePermission(
  expression: ts.Expression
): RuntimePermission {
  if (ts.isObjectLiteralExpression(expression)) {
    return extractRuntimePermissionObject(expression)
  }

  if (
    ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)
  ) {
    const type = runtimeHelperType(expression.expression.text)

    if (type !== undefined) {
      const values = expression.arguments[0]
      return runtimePermissionFromValues(type, values)
    }
  }

  throw new PluginBuildError(
    `Could not statically resolve runtime permission ${expression.getText()}`
  )
}

function extractRuntimePermissionObject(
  expression: ts.ObjectLiteralExpression
): RuntimePermission {
  const type = requiredString(expression, 'type') as RuntimePermission['type']

  switch (type) {
    case 'net':
      return withOptionalValues(type, expression, 'urls')
    case 'read':
    case 'write':
    case 'ffi':
      return withOptionalValues(type, expression, 'paths')
    case 'env':
      return withOptionalValues(type, expression, 'variables')
    case 'sys':
      return withOptionalValues(type, expression, 'apis')
    case 'run':
      return withOptionalValues(type, expression, 'programs')
    case 'import':
      return withOptionalValues(type, expression, 'hosts')
  }
}

function runtimePermissionFromValues(
  type: RuntimePermission['type'],
  values: ts.Expression | undefined
): RuntimePermission {
  const strings = values === undefined ? undefined : extractStringArray(values)

  switch (type) {
    case 'net':
      return strings === undefined ? { type } : { type, urls: strings }
    case 'read':
    case 'write':
    case 'ffi':
      return strings === undefined ? { type } : { type, paths: strings }
    case 'env':
      return strings === undefined ? { type } : { type, variables: strings }
    case 'sys':
      return strings === undefined ? { type } : { type, apis: strings }
    case 'run':
      return strings === undefined ? { type } : { type, programs: strings }
    case 'import':
      return strings === undefined ? { type } : { type, hosts: strings }
  }
}

function withOptionalValues<T extends RuntimePermission['type']>(
  type: T,
  expression: ts.ObjectLiteralExpression,
  property: string
): RuntimePermission {
  const values = optionalArray(expression, property)?.map((value) => {
    if (ts.isStringLiteral(value)) {
      return value.text
    }

    throw new PluginBuildError(
      `Runtime permission ${property} must contain only string literals`
    )
  })

  return runtimePermissionFromValues(
    type,
    values === undefined ? undefined : arrayLiteral(values)
  )
}

function runtimeHelperType(
  name: string
): RuntimePermission['type'] | undefined {
  if (name === 'import_') {
    return 'import'
  }

  if (
    name === 'net' ||
    name === 'read' ||
    name === 'write' ||
    name === 'env' ||
    name === 'sys' ||
    name === 'run' ||
    name === 'ffi'
  ) {
    return name
  }
}

function optionalString(
  object: ts.ObjectLiteralExpression,
  ...names: string[]
) {
  const value = optionalProperty(object, names)

  if (value === undefined) {
    return undefined
  }

  if (!ts.isStringLiteral(value)) {
    throw new PluginBuildError(`${names[0]} must be a string literal`)
  }

  return value.text
}

function requiredString(
  object: ts.ObjectLiteralExpression,
  ...names: string[]
) {
  const value = optionalString(object, ...names)

  if (value === undefined) {
    throw new PluginBuildError(`Missing required plugin property ${names[0]}`)
  }

  return value
}

function requiredStringArray(
  object: ts.ObjectLiteralExpression,
  ...names: string[]
) {
  const values = optionalArray(object, ...names)

  if (values === undefined) {
    throw new PluginBuildError(`Missing required plugin property ${names[0]}`)
  }

  return values.map((value) => {
    if (!ts.isStringLiteral(value)) {
      throw new PluginBuildError(
        `${names[0]} must contain only string literals`
      )
    }

    return value.text
  })
}

function optionalArray(
  object: ts.ObjectLiteralExpression,
  ...names: string[]
) {
  const value = optionalProperty(object, names)

  if (value === undefined) {
    return undefined
  }

  if (!ts.isArrayLiteralExpression(value)) {
    throw new PluginBuildError(`${names[0]} must be an array literal`)
  }

  return [...value.elements]
}

function optionalProperty(
  object: ts.ObjectLiteralExpression,
  names: string[]
) {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue
    }

    const name = propertyName(property.name)

    if (name !== undefined && names.includes(name)) {
      return unwrapExpression(property.initializer)
    }
  }
}

function propertyName(name: ts.PropertyName) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
    return name.text
  }
}

function extractStringArray(expression: ts.Expression) {
  if (!ts.isArrayLiteralExpression(expression)) {
    throw new PluginBuildError(
      'Runtime permission helper values must be an array literal'
    )
  }

  return expression.elements.map((element) => {
    if (!ts.isStringLiteral(element)) {
      throw new PluginBuildError(
        'Runtime permission helper values must contain only string literals'
      )
    }

    return element.text
  })
}

function isNamedCall(
  expression: ts.Expression,
  name: string
): expression is ts.CallExpression {
  return ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === name
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  if (
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isParenthesizedExpression(expression)
  ) {
    return unwrapExpression(expression.expression)
  }

  return expression
}

function createSourceFile(path: string, text: string) {
  return ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
}

function resolveModulePath(fromFile: string, specifier: string) {
  const base = new URL(`file://${fromFile}`).href
  const resolved = new URL(specifier, base)
  const path = decodeURIComponent(resolved.pathname)

  if (/\.[cm]?tsx?$/.test(path)) {
    return path
  }

  return `${path}.ts`
}

function realPath(path: string): Effect.Effect<string> {
  return Effect.tryPromise({
    try: () => Deno.realPath(path),
    catch: () => undefined
  }).pipe(Effect.catchAll(() => Effect.succeed(path)))
}

function joinPath(directory: string, file: string) {
  if (directory.endsWith('/')) {
    return `${directory}${file}`
  }

  return `${directory}/${file}`
}

function arrayLiteral(values: readonly string[]) {
  return ts.factory.createArrayLiteralExpression(
    values.map((value) => ts.factory.createStringLiteral(value))
  )
}

function buildBundleArgs(
  options: BundlePluginOptions,
  tempPath: string
) {
  const args = [
    'bundle',
    '--quiet',
    '--platform',
    'deno',
    tempPath,
    '--output',
    options.packagePath
  ]

  if (options.config !== undefined) {
    args.push('--config', options.config)
  }

  return args
}

function denoBundle(
  args: string[]
): Effect.Effect<Deno.CommandOutput, PluginBuildError> {
  return Effect.tryPromise({
    try: () =>
      new Deno.Command(Deno.execPath(), {
        args,
        stdout: 'piped',
        stderr: 'piped'
      }).output(),
    catch: (cause) =>
      new PluginBuildError(
        `Failed to execute Deno bundle command${errorDetails(cause)}`
      )
  })
}

function readTextFile(path: string): Effect.Effect<string, PluginBuildError> {
  return Effect.tryPromise({
    try: () => Deno.readTextFile(path),
    catch: (cause) =>
      new PluginBuildError(`Failed to read ${path}${errorDetails(cause)}`)
  })
}

function writeTextFile(
  path: string,
  data: string
): Effect.Effect<void, PluginBuildError> {
  return Effect.tryPromise({
    try: () => Deno.writeTextFile(path, data),
    catch: (cause) =>
      new PluginBuildError(`Failed to write ${path}${errorDetails(cause)}`)
  })
}

function makeDir(path: string): Effect.Effect<void, PluginBuildError> {
  return Effect.tryPromise({
    try: () => Deno.mkdir(path, { recursive: true }),
    catch: (cause) =>
      new PluginBuildError(
        `Failed to create directory ${path}${errorDetails(cause)}`
      )
  })
}

function removeFileIfExists(path: string): Effect.Effect<void> {
  return Effect.tryPromise({
    try: () => Deno.remove(path),
    catch: () => undefined
  }).pipe(Effect.catchAll(() => Effect.void))
}

function bundleFailure(output: Deno.CommandOutput) {
  const stderr = new TextDecoder().decode(output.stderr).trim()
  const stdout = new TextDecoder().decode(output.stdout).trim()

  return new PluginBuildError(
    `Failed to bundle plugin package.${stderr ? `\n${stderr}` : ''}${
      stdout ? `\n${stdout}` : ''
    }`
  )
}

function toPluginBuildError(cause: unknown) {
  if (cause instanceof PluginBuildError) {
    return cause
  }

  return new PluginBuildError(`Failed to build plugin${errorDetails(cause)}`)
}

function errorDetails(cause: unknown) {
  if (cause instanceof Error && cause.message !== '') {
    return `: ${cause.message}`
  }

  if (cause === undefined) {
    return ''
  }

  return `: ${String(cause)}`
}

export type BuildPluginOptions = {
  source: string
  outDir?: string
  packageFile?: string
  metadataFile?: string
  metadataEntrypoint?: string
  config?: string
  runtimeImport?: string
}

export type BuildPluginResult = {
  metadata: PluginMetadata
  packagePath: string
  metadataPath: string
}

type AnalyzePluginSourceOptions = {
  metadataEntrypoint: string
}

type AnalyzePluginSourceResult = {
  pluginIdentifier: string
  metadata: PluginMetadata
}

type BundlePluginOptions = {
  sourcePath: string
  sourceText: string
  pluginIdentifier: string
  packagePath: string
  config?: string
  runtimeImport: string
}
