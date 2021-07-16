import MagicString from 'magic-string'
import { TransformResult } from 'rollup'
import { ResolvedConfig } from '../config'
import { Plugin } from '../plugin'
import { isCSSRequest } from './css'

export function definePlugin(config: ResolvedConfig): Plugin {
  const isBuild = config.command === 'build'

  const userDefine: Record<string, string> = {}
  for (const key in config.define) {
    const val = config.define[key]
    userDefine[key] = typeof val === 'string' ? val : JSON.stringify(val)
  }

  // during dev, import.meta properties are handled by importAnalysis plugin
  const importMetaKeys: Record<string, string> = {}
  if (isBuild) {
    const env: Record<string, any> = {
      ...config.env,
      SSR: !!config.build.ssr
    }
    for (const key in env) {
      importMetaKeys[`import.meta.env.${key}`] = JSON.stringify(env[key])
    }
    Object.assign(importMetaKeys, {
      'import.meta.env.': `({}).`,
      'import.meta.env': JSON.stringify(config.env),
      'import.meta.hot': `false`
    })
  }

  function generatePattern(
    ssr: boolean
  ): [Record<string, string | undefined>, RegExp] {
    const processEnv = ssr
      ? {
          // account for non-node environments like v8
          'process.env.': `(typeof process === 'undefined' ? {} : process.env).`,
          'global.process.env.': `(typeof global.process === 'undefined' ? {} : global.process.env).`,
          'globalThis.process.env.': `(typeof globalThis.process === 'undefined' ? {} : globalThis.process.env).`
        }
      : {
          // client never has process
          'process.env.': `({}).`,
          'global.process.env.': `({}).`,
          'globalThis.process.env.': `({}).`
        }

    const replacements: Record<string, string | undefined> = {
      'process.env.NODE_ENV': JSON.stringify(
        process.env.NODE_ENV || config.mode
      ),
      'global.process.env.NODE_ENV': JSON.stringify(
        process.env.NODE_ENV || config.mode
      ),
      'globalThis.process.env.NODE_ENV': JSON.stringify(
        process.env.NODE_ENV || config.mode
      ),
      ...userDefine,
      ...importMetaKeys,
      ...processEnv
    }

    const pattern = new RegExp(
      '(?<!\\.)\\b(' +
        Object.keys(replacements)
          .map((str) => {
            return str.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&')
          })
          .join('|') +
        ')\\b',
      'g'
    )

    return [replacements, pattern]
  }

  const defaultPattern = generatePattern(false)
  const ssrPattern = generatePattern(true)

  return {
    name: 'vite:define',
    transform(code, id, ssr) {
      if (!ssr && !isBuild) {
        // for dev we inject actual global defines in the vite client to
        // avoid the transform cost.
        return
      }

      if (
        // exclude css and static assets for performance
        isCSSRequest(id) ||
        config.assetsInclude(id)
      ) {
        return
      }

      const [replacements, pattern] = ssr ? ssrPattern : defaultPattern

      if (ssr && !isBuild) {
        // ssr + dev, simple replace
        return code.replace(pattern, (_, match) => {
          return '' + replacements[match]
        })
      }

      const s = new MagicString(code)
      let hasReplaced = false
      let match

      while ((match = pattern.exec(code))) {
        hasReplaced = true
        const start = match.index
        const end = start + match[0].length
        const replacement = '' + replacements[match[1]]
        s.overwrite(start, end, replacement)
      }

      if (!hasReplaced) {
        return null
      }

      const result: TransformResult = { code: s.toString() }
      if (config.build.sourcemap) {
        result.map = s.generateMap({ hires: true })
      }
      return result
    }
  }
}
