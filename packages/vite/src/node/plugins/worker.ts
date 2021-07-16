import { ResolvedConfig } from '../config'
import { Plugin } from '../plugin'
import { resolvePlugins } from '../plugins'
import { parse as parseUrl } from 'url'
import qs, { ParsedUrlQuery } from 'querystring'
import { fileToUrl, getAssetHash } from './asset'
import { cleanUrl, injectQuery } from '../utils'
import Rollup from 'rollup'
import { ENV_PUBLIC_PATH } from '../constants'
import path from 'path'

function parseWorkerRequest(id: string): ParsedUrlQuery | null {
  const { search } = parseUrl(id)
  if (!search) {
    return null
  }
  return qs.parse(search.slice(1))
}

const WorkerFileId = 'worker_file'

/**
 * Create a factory for the worker constructor string.
 * Can be combined with other strings to build an inline script.
 *
 * @param query Parsed worker request data
 * @returns Factory function taking URL and worker options.
 * Null is returned if the worker request is invalid.
 */
function buildWorkerConstructor(query: ParsedUrlQuery | null) {
  if (!query) {
    return null
  }

  let workerConstructor: string
  if (query.sharedworker != null) {
    workerConstructor = 'SharedWorker'
  } else if (query.worker != null) {
    workerConstructor = 'Worker'
  } else {
    return null
  }

  return (urlVariable: string, options?: object) => {
    if (options) {
      return `new ${workerConstructor}(${urlVariable}, ${JSON.stringify(
        options,
        null,
        2
      )})`
    } else {
      return `new ${workerConstructor}(${urlVariable})`
    }
  }
}

export function webWorkerPlugin(config: ResolvedConfig): Plugin {
  const isBuild = config.command === 'build'

  return {
    name: 'vite:worker',

    load(id) {
      if (isBuild) {
        const parsedQuery = parseWorkerRequest(id)
        if (buildWorkerConstructor(parsedQuery) != null) {
          return ''
        }
      }
    },

    async transform(_, id) {
      const query = parseWorkerRequest(id)
      if (query && query[WorkerFileId] != null) {
        return {
          code: `import '${ENV_PUBLIC_PATH}'\n` + _
        }
      }

      const workerConstructor = buildWorkerConstructor(query)
      if (query == null || workerConstructor == null) {
        return
      }

      let url: string
      if (isBuild) {
        // bundle the file as entry to support imports
        const rollup = require('rollup') as typeof Rollup
        const bundle = await rollup.rollup({
          input: cleanUrl(id),
          plugins: await resolvePlugins({ ...config }, [], [], [])
        })
        let code: string
        try {
          const { output } = await bundle.generate({
            format: 'iife',
            sourcemap: config.build.sourcemap
          })
          code = output[0].code
        } finally {
          await bundle.close()
        }
        const content = Buffer.from(code)
        if (query.inline != null) {
          // inline as blob data url
          return `const blob = new Blob([atob(\"${content.toString(
            'base64'
          )}\")], { type: 'text/javascript;charset=utf-8' });
          const URL = window.URL || window.webkitURL;
            export default function WorkerWrapper() {
              const objURL = URL.createObjectURL(blob);
              try {
                return ${workerConstructor('objUrl')};
              } finally {
                URL.revokeObjectURL(objURL);
              }
            }`
        } else {
          const basename = path.parse(cleanUrl(id)).name
          const contentHash = getAssetHash(content)
          const fileName = path.posix.join(
            config.build.assetsDir,
            `${basename}.${contentHash}.js`
          )
          url = `__VITE_ASSET__${this.emitFile({
            fileName,
            type: 'asset',
            source: code
          })}__`
        }
      } else {
        url = await fileToUrl(cleanUrl(id), config, this)
        url = injectQuery(url, WorkerFileId)
      }

      const workerUrl = JSON.stringify(url)
      const workerOptions = { type: 'module' }

      return `export default function WorkerWrapper() {
        return ${workerConstructor(workerUrl, workerOptions)};
      }`
    }
  }
}
