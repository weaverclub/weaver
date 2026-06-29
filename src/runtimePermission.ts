import { Schema } from 'effect'

export const RuntimePermissionSchema: Schema.Schema<RuntimePermission> = Schema
  .Union(
    Schema.Struct({
      type: Schema.Literal('net'),
      urls: Schema.optional(Schema.Array(Schema.String))
    }),
    Schema.Struct({
      type: Schema.Literal('read'),
      paths: Schema.optional(Schema.Array(Schema.String))
    }),
    Schema.Struct({
      type: Schema.Literal('write'),
      paths: Schema.optional(Schema.Array(Schema.String))
    }),
    Schema.Struct({
      type: Schema.Literal('env'),
      variables: Schema.optional(Schema.Array(Schema.String))
    }),
    Schema.Struct({
      type: Schema.Literal('sys'),
      apis: Schema.optional(Schema.Array(Schema.String))
    }),
    Schema.Struct({
      type: Schema.Literal('run'),
      programs: Schema.optional(Schema.Array(Schema.String))
    }),
    Schema.Struct({
      type: Schema.Literal('ffi'),
      paths: Schema.optional(Schema.Array(Schema.String))
    }),
    Schema.Struct({
      type: Schema.Literal('import'),
      hosts: Schema.optional(Schema.Array(Schema.String))
    })
  )

export function runtimePermissionKey(permission: RuntimePermission): string {
  switch (permission.type) {
    case 'net':
      return stablePermissionKey(permission.type, permission.urls)
    case 'read':
      return stablePermissionKey(permission.type, permission.paths)
    case 'write':
      return stablePermissionKey(permission.type, permission.paths)
    case 'env':
      return stablePermissionKey(permission.type, permission.variables)
    case 'sys':
      return stablePermissionKey(permission.type, permission.apis)
    case 'run':
      return stablePermissionKey(permission.type, permission.programs)
    case 'ffi':
      return stablePermissionKey(permission.type, permission.paths)
    case 'import':
      return stablePermissionKey(permission.type, permission.hosts)
  }
}

function stablePermissionKey(
  type: RuntimePermission['type'],
  values: readonly string[] | undefined
): string {
  return JSON.stringify({
    type,
    values: values ? [...values].sort() : undefined
  })
}

function mergePermissionValues(
  result: Record<string, string[] | true>,
  key: string,
  values: readonly string[] | undefined
) {
  if (!(key in result)) {
    result[key] = values ? [...values] : true
    return
  }

  if (result[key] === true || values === undefined) {
    result[key] = true
    return
  }

  result[key] = [...new Set([...result[key], ...values])]
}

export function toDenoPermission(
  permissions: readonly RuntimePermission[]
): Deno.PermissionOptionsObject {
  const result: Record<string, string[] | true> = {}

  for (const permission of permissions) {
    switch (permission.type) {
      case 'net':
        mergePermissionValues(result, permission.type, permission.urls)
        break
      case 'read':
        mergePermissionValues(result, permission.type, permission.paths)
        break
      case 'write':
        mergePermissionValues(result, permission.type, permission.paths)
        break
      case 'env':
        mergePermissionValues(result, permission.type, permission.variables)
        break
      case 'sys':
        mergePermissionValues(result, permission.type, permission.apis)
        break
      case 'run':
        mergePermissionValues(result, permission.type, permission.programs)
        break
      case 'ffi':
        mergePermissionValues(result, permission.type, permission.paths)
        break
      case 'import':
        mergePermissionValues(result, permission.type, permission.hosts)
        break
    }
  }

  return result as Deno.PermissionOptionsObject
}

/**
 * Shorthand helper for creating a network permission (`--allow-net`).
 *
 * @param urls - Optional list of allowed host URLs. Omit to allow all network access.
 *
 * @example
 * ```ts
 * net()                              // allow all network access
 * net(["example.com"])               // allow example.com
 * net(["example.com:80"])            // allow example.com on port 80
 * net(["*.example.com"])             // allow all subdomains of example.com
 * net(["1.1.1.1:443"])               // allow an IPv4 address on port 443
 * net(["[2606:4700:4700::1111]"])    // allow an IPv6 address
 * ```
 */
export function net(urls?: string[]): RuntimePermission {
  return urls ? { type: 'net', urls } : { type: 'net' }
}

/**
 * Shorthand helper for creating a file system read permission (`--allow-read`).
 *
 * @param paths - Optional list of allowed file/directory paths. Omit to allow all reads.
 *
 * @example
 * ```ts
 * read()                         // allow reading all files
 * read(["/etc"])                 // allow reading /etc and subdirectories
 * read(["foo.txt", "bar.txt"])   // allow reading specific files
 * ```
 */
export function read(paths?: string[]): RuntimePermission {
  return paths ? { type: 'read', paths } : { type: 'read' }
}

/**
 * Shorthand helper for creating a file system write permission (`--allow-write`).
 *
 * @param paths - Optional list of allowed file/directory paths. Omit to allow all writes.
 *
 * @example
 * ```ts
 * write()                    // allow writing to all files
 * write(["./data"])          // allow writing to ./data and subdirectories
 * ```
 */
export function write(paths?: string[]): RuntimePermission {
  return paths ? { type: 'write', paths } : { type: 'write' }
}

/**
 * Shorthand helper for creating an environment variable permission (`--allow-env`).
 *
 * @param variables - Optional list of allowed environment variable names.
 *                    Supports suffix wildcards (e.g. `"AWS_*"`).
 *                    Omit to allow all environment variables.
 *
 * @example
 * ```ts
 * env()                          // allow all environment variables
 * env(["HOME", "PATH"])          // allow specific variables
 * env(["AWS_*"])                 // allow all variables starting with AWS_
 * ```
 */
export function env(variables?: string[]): RuntimePermission {
  return variables ? { type: 'env', variables } : { type: 'env' }
}

/**
 * Shorthand helper for creating a system information permission (`--allow-sys`).
 *
 * @param apis - Optional list of allowed system API names.
 *               See {@link https://docs.deno.com/api/deno/~/Deno.SysPermissionDescriptor | Deno.SysPermissionDescriptor}
 *               for valid values. Omit to allow all system information APIs.
 *
 * @example
 * ```ts
 * sys()                                        // allow all system information APIs
 * sys(["systemMemoryInfo", "osRelease"])        // allow specific APIs
 * ```
 */
export function sys(apis?: string[]): RuntimePermission {
  return apis ? { type: 'sys', apis } : { type: 'sys' }
}

/**
 * Shorthand helper for creating a subprocess permission (`--allow-run`).
 *
 * @param programs - Optional list of allowed executable names. Omit to allow all subprocesses.
 *
 * @example
 * ```ts
 * run()                          // allow running all subprocesses
 * run(["curl", "whoami"])        // allow specific programs only
 * ```
 *
 * @remarks
 * **WARNING:** Granting this permission effectively invalidates the Deno security sandbox,
 * as child processes run independently of the parent's permissions.
 */
export function run(programs?: string[]): RuntimePermission {
  return programs ? { type: 'run', programs } : { type: 'run' }
}

/**
 * Shorthand helper for creating an FFI (Foreign Function Interface) permission (`--allow-ffi`).
 *
 * @param paths - Optional list of allowed dynamic library paths. Omit to allow all libraries.
 *
 * @example
 * ```ts
 * ffi()                         // allow loading all dynamic libraries
 * ffi(["./libfoo.so"])          // allow loading a specific library
 * ```
 *
 * @remarks
 * **WARNING:** Dynamic libraries are not sandboxed and have the same access as the
 * host process. Use with extreme caution.
 */
export function ffi(paths?: string[]): RuntimePermission {
  return paths ? { type: 'ffi', paths } : { type: 'ffi' }
}

/**
 * Shorthand helper for creating an import permission (`--allow-import`).
 *
 * @param hosts - Optional list of allowed import hosts.
 *                When specified, this *overrides* Deno's default trusted host list.
 *                Omit to allow imports from the default trusted hosts only.
 *
 * @example
 * ```ts
 * import_()                         // allow imports from default trusted hosts
 * import_(["example.com"])          // allow imports from example.com (overrides defaults)
 * ```
 *
 * @remarks
 * `import_` is used instead of `import` because `import` is a reserved keyword in JavaScript/TypeScript.
 *
 * Deno's default trusted hosts for static imports are:
 * `deno.land`, `esm.sh`, `jsr.io`, `cdn.jsdelivr.net`, `raw.githubusercontent.com`, `gist.githubusercontent.com`.
 */
export function import_(hosts?: string[]): RuntimePermission {
  return hosts ? { type: 'import', hosts } : { type: 'import' }
}

/**
 * Runtime permissions map directly to Deno's `--allow-*` / `--deny-*` flags,
 * enforced at the OS level via the Deno Worker constructor.
 *
 * Based on: https://docs.deno.com/runtime/fundamentals/security/#permissions
 */
export type RuntimePermission =
  | {
    /**
     * Network access permission (`--allow-net`).
     *
     * Examples:
     * - `{ type: 'net' }` — allows all network access
     * - `{ type: 'net', urls: ["example.com"] }` — allows access to example.com
     * - `{ type: 'net', urls: ["example.com:80"] }` — allows example.com on port 80
     * - `{ type: 'net', urls: ["*.example.com"] }` — allows all subdomains of example.com
     * - `{ type: 'net', urls: ["1.1.1.1:443"] }` — allows an IPv4 address on port 443
     * - `{ type: 'net', urls: ["[2606:4700:4700::1111]"] }` — allows an IPv6 address
     */
    type: 'net'
    urls?: readonly string[] | undefined
  }
  | {
    /**
     * File system read permission (`--allow-read`).
     *
     * Examples:
     * - `{ type: 'read' }` — allows reading all files
     * - `{ type: 'read', paths: ["/etc"] }` — allows reading /etc and subdirectories
     * - `{ type: 'read', paths: ["foo.txt", "bar.txt"] }` — allows reading specific files
     */
    type: 'read'
    paths?: readonly string[] | undefined
  }
  | {
    /**
     * File system write permission (`--allow-write`).
     *
     * Examples:
     * - `{ type: 'write' }` — allows writing to all files
     * - `{ type: 'write', paths: ["./data"] }` — allows writing to ./data and subdirectories
     */
    type: 'write'
    paths?: readonly string[] | undefined
  }
  | {
    /**
     * Environment variable access permission (`--allow-env`).
     *
     * Examples:
     * - `{ type: 'env' }` — allows access to all environment variables
     * - `{ type: 'env', variables: ["HOME", "PATH"] }` — allows specific variables
     * - `{ type: 'env', variables: ["AWS_*"] }` — allows all variables starting with AWS_ (suffix wildcard)
     */
    type: 'env'
    variables?: readonly string[] | undefined
  }
  | {
    /**
     * System information access permission (`--allow-sys`).
     *
     * Examples:
     * - `{ type: 'sys' }` — allows all system information APIs
     * - `{ type: 'sys', apis: ["systemMemoryInfo", "osRelease"] }` — allows specific APIs
     *
     * See: https://docs.deno.com/api/deno/~/Deno.SysPermissionDescriptor
     */
    type: 'sys'
    apis?: readonly string[] | undefined
  }
  | {
    /**
     * Subprocess permission (`--allow-run`).
     *
     * Examples:
     * - `{ type: 'run' }` — allows running all subprocesses
     * - `{ type: 'run', programs: ["curl", "whoami"] }` — allows specific programs only
     *
     * WARNING: Granting this permission effectively invalidates the Deno security
     * sandbox, as child processes run independently of the parent's permissions.
     */
    type: 'run'
    programs?: readonly string[] | undefined
  }
  | {
    /**
     * FFI (Foreign Function Interface) permission (`--allow-ffi`).
     *
     * Examples:
     * - `{ type: 'ffi' }` — allows loading all dynamic libraries
     * - `{ type: 'ffi', paths: ["./libfoo.so"] }` — allows loading specific libraries
     *
     * WARNING: Dynamic libraries are not sandboxed and have the same access as the
     * host process. Use with extreme caution.
     */
    type: 'ffi'
    paths?: readonly string[] | undefined
  }
  | {
    /**
     * Import from web permission (`--allow-import`).
     *
     * Examples:
     * - `{ type: 'import' }` — allows importing from default trusted hosts
     * - `{ type: 'import', hosts: ["example.com"] }` — allows importing from specific hosts
     *
     * Note: Deno allows imports from these hosts by default for static imports:
     * deno.land, esm.sh, jsr.io, cdn.jsdelivr.net, raw.githubusercontent.com, gist.githubusercontent.com.
     * Specifying an allow-list overrides these defaults.
     */
    type: 'import'
    hosts?: readonly string[] | undefined
  }
