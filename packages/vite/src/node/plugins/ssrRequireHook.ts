import MagicString from 'magic-string'
import { ResolvedConfig } from '..'
import { Plugin } from '../plugin'

export function ssrRequireHookPlugin(config: ResolvedConfig): Plugin | null {
  if (config.command !== 'build' || !config.resolve.dedupe?.length) {
    return null
  }
  return {
    name: 'vite:ssr-require-hook',
    transform(code, id) {
      const moduleInfo = this.getModuleInfo(id)
      if (moduleInfo?.isEntry) {
        const s = new MagicString(code)
        s.prepend(
          `;(${dedupeRequire.toString()})(${JSON.stringify(
            config.resolve.dedupe
          )});\n`
        )
        return {
          code: s.toString(),
          map: s.generateMap({
            source: id
          })
        }
      }
    }
  }
}

type NodeResolveFilename = (
  request: string,
  parent: NodeModule,
  isMain: boolean,
  options?: Record<string, any>
) => string

/** Respect the `resolve.dedupe` option in production SSR. */
function dedupeRequire(dedupe: string[]) {
  const Module = require('module') as { _resolveFilename: NodeResolveFilename }
  const resolveFilename = Module._resolveFilename
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request[0] !== '.' && request[0] !== '/') {
      const parts = request.split('/')
      const pkgName = parts[0][0] === '@' ? parts[0] + '/' + parts[1] : parts[0]
      if (dedupe.includes(pkgName)) {
        // Use this module as the parent.
        parent = module
      }
    }
    return resolveFilename!(request, parent, isMain, options)
  }
}

export function hookNodeResolve(resolver: NodeResolveFilename) {
  const Module = require('module') as { _resolveFilename: NodeResolveFilename }
  const resolveFilename = Module._resolveFilename
  Module._resolveFilename = resolver
  return () => {
    Module._resolveFilename = resolveFilename
  }
}
