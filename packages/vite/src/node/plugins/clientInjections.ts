import path from 'path'
import { Plugin } from '../plugin'
import { ResolvedConfig } from '../config'
import { CLIENT_ENTRY, ENV_ENTRY } from '../constants'
import { isExternalUrl, normalizePath } from '../utils'

// ids in transform are normalized to unix style
const normalizedClientEntry = normalizePath(CLIENT_ENTRY)
const normalizedEnvEntry = normalizePath(ENV_ENTRY)

/**
 * some values used by the client needs to be dynamically injected by the server
 * @server-only
 */
export function clientInjectionsPlugin(config: ResolvedConfig): Plugin {
  return {
    name: 'vite:client-inject',
    transform(code, id) {
      if (id === normalizedClientEntry || id === normalizedEnvEntry) {
        let options = config.server.hmr
        options = options && typeof options !== 'boolean' ? options : {}
        const host = options.host || null
        const protocol = options.protocol || null
        const timeout = options.timeout || 30000
        const overlay = options.overlay !== false
        let port
        if (config.server.middlewareMode) {
          if (typeof config.server.hmr === 'object') {
            port = config.server.hmr.clientPort || config.server.hmr.port
          }
          port = String(port || 24678)
        } else {
          port = String(options.port || config.server.port!)
        }
        let hmrBase = config.base
        if (options.path) {
          hmrBase = hmrBase + options.path
        }
        if (hmrBase !== '/' && !isExternalUrl(hmrBase)) {
          port = path.posix.normalize(`${port}${hmrBase}`)
        }

        return code
          .replace(`__MODE__`, JSON.stringify(config.mode))
          .replace(`__BASE__`, JSON.stringify(config.base))
          .replace(`__ROOT__`, JSON.stringify(config.root))
          .replace(`__DEFINES__`, serializeDefine(config.define || {}))
          .replace(`__HMR_PROTOCOL__`, JSON.stringify(protocol))
          .replace(`__HMR_HOSTNAME__`, JSON.stringify(host))
          .replace(`__HMR_PORT__`, JSON.stringify(port))
          .replace(`__HMR_TIMEOUT__`, JSON.stringify(timeout))
          .replace(`__HMR_ENABLE_OVERLAY__`, JSON.stringify(overlay))
      } else if (code.includes('process.env.NODE_ENV')) {
        // replace process.env.NODE_ENV
        return code.replace(
          /\bprocess\.env\.NODE_ENV\b/g,
          JSON.stringify(config.mode)
        )
      }
    }
  }
}

function serializeDefine(define: Record<string, any>): string {
  let res = `{`
  for (const key in define) {
    const val = define[key]
    res += `${JSON.stringify(key)}: ${
      typeof val === 'string' ? `(${val})` : JSON.stringify(val)
    }, `
  }
  return res + `}`
}
