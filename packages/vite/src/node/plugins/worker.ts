import { ResolvedConfig } from '../config'
import { Plugin } from '../plugin'
import { parse as parseUrl } from 'url'
import qs, { ParsedUrlQuery } from 'querystring'
import { fileToUrl } from './asset'
import { cleanUrl, injectQuery } from '../utils'
import Rollup from 'rollup'
import { ENV_PUBLIC_PATH } from '../constants'
import fs from 'fs'

function parseWorkerRequest(id: string): ParsedUrlQuery | null {
  const { search } = parseUrl(id)
  if (!search) {
    return null
  }
  return qs.parse(search.slice(1))
}

const WorkerFileId = 'worker_file'

export function webWorkerPlugin(config: ResolvedConfig): Plugin {
  const isBuild = config.command === 'build'

  return {
    name: 'vite:worker',

    load(id) {
      const query = parseWorkerRequest(id)
      if (query && (query.worker != null || query[WorkerFileId] != null)) {
        return fs.readFileSync(cleanUrl(id), 'utf-8')
      }
    },

    async transform(_, id) {
      const query = parseWorkerRequest(id)
      if (query && query[WorkerFileId] != null) {
        return {
          code: `import '${ENV_PUBLIC_PATH}'\n` + _
        }
      }
      if (query == null || (query && query.worker == null)) {
        return
      }

      let url: string
      if (isBuild) {
        if (query.inline != null) {
          // bundle the file as entry to support imports and inline as base64
          // data url
          const rollup = require('rollup') as typeof Rollup
          const bundle = await rollup.rollup({
            input: cleanUrl(id),
            plugins: config.plugins as Plugin[]
          })
          try {
            const { output } = await bundle.generate({
              format: 'es',
              sourcemap: config.build.sourcemap
            })
            url = `data:application/javascript;base64,${Buffer.from(
              output[0].code
            ).toString('base64')}`
          } finally {
            await bundle.close()
          }
        } else {
          // emit as separate chunk
          url = `__VITE_ASSET__${this.emitFile({
            type: 'chunk',
            id: cleanUrl(id)
          })}__`
        }
      } else {
        url = await fileToUrl(cleanUrl(id), config, this)
        url = injectQuery(url, WorkerFileId)
      }

      return `export default function WorkerWrapper() {
        return new Worker(${JSON.stringify(url)}, { type: 'module' })
      }`
    }
  }
}
