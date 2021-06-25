import MagicString from 'magic-string'
import { ResolvedConfig } from '..'
import { Plugin } from '../plugin'

const impl = `;(function() {
  const Module = require("module")
  const resolveFilename = Module._resolveFilename
  const dedupe = DEDUPE_IDS
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request[0] !== "." && request[0] !== "/") {
      const parts = request.split("/")
      const pkgName = parts[0][0] === "@" ? parts[0] + "/" + parts[1] : parts[0]
      if (dedupe.includes(pkgName)) {
        // Use this module as the parent.
        parent = module
      }
    }
    return resolveFilename(request, parent, isMain, options)
  }
})();
`

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
          impl.replace('DEDUPE_IDS', JSON.stringify(config.resolve.dedupe))
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
