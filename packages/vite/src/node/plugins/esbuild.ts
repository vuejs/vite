import path from 'path'
import chalk from 'chalk'
import { Plugin } from '../plugin'
import {
  transform,
  Message,
  Loader,
  TransformOptions,
  TransformResult
} from 'esbuild'
import { cleanUrl, createDebugger, generateCodeFrame } from '../utils'
import { RawSourceMap } from '@ampproject/remapping/dist/types/types'
import { SourceMap } from 'rollup'
import { ResolvedConfig } from '..'
import { createFilter } from '@rollup/pluginutils'
import { combineSourcemaps } from '../utils'
import { find as findTSConfig, readFile as readTSConfig } from 'tsconfig'
import { createRequire } from 'module'

const debug = createDebugger('vite:esbuild')

export interface ESBuildOptions extends TransformOptions {
  include?: string | RegExp | string[] | RegExp[]
  exclude?: string | RegExp | string[] | RegExp[]
  jsxInject?: string
}

export type ESBuildTransformResult = Omit<TransformResult, 'map'> & {
  map: SourceMap
}

type TSConfigJSON = {
  extends?: string
  compilerOptions?: {
    target?: string
    jsxFactory?: string
    jsxFragmentFactory?: string
    useDefineForClassFields?: boolean
    importsNotUsedAsValues?: 'remove' | 'preserve' | 'error'
  }
  [key: string]: any
}
type TSCompilerOptions = NonNullable<TSConfigJSON['compilerOptions']>

const tsconfigCache = new Map<string, TSConfigJSON>()
async function loadTsconfigJsonForFile(
  filename: string
): Promise<TSConfigJSON> {
  const directory = path.dirname(filename)

  const cached = tsconfigCache.get(directory)
  if (cached) {
    return cached
  }

  let configPath = await findTSConfig(directory)
  let tsconfig: TSConfigJSON = {}

  if (configPath) {
    tsconfig = (await readTSConfig(configPath)) as TSConfigJSON
    while (tsconfig.extends) {
      const configRequire = createRequire(configPath)

      const extendsPath = configRequire.resolve(tsconfig.extends)
      const extendedConfig = (await readTSConfig(extendsPath)) as TSConfigJSON

      tsconfig = {
        extends: extendedConfig.extends,
        compilerOptions: {
          ...extendedConfig.compilerOptions,
          ...tsconfig.compilerOptions
        }
      }
      configPath = extendsPath
    }
  }

  tsconfigCache.set(directory, tsconfig)
  return tsconfig
}

export async function transformWithEsbuild(
  code: string,
  filename: string,
  options?: TransformOptions,
  inMap?: object
): Promise<ESBuildTransformResult> {
  // if the id ends with a valid ext, use it (e.g. vue blocks)
  // otherwise, cleanup the query before checking the ext
  const ext = path.extname(
    /\.\w+$/.test(filename) ? filename : cleanUrl(filename)
  )

  let loader = ext.slice(1)
  if (loader === 'cjs' || loader === 'mjs') {
    loader = 'js'
  }

  // these fields would affect the compilation result
  // https://esbuild.github.io/content-types/#tsconfig-json
  const meaningfulFields: Array<keyof TSCompilerOptions> = [
    'jsxFactory',
    'jsxFragmentFactory',
    'useDefineForClassFields',
    'importsNotUsedAsValues'
  ]
  const compilerOptionsForFile: TSCompilerOptions = {}
  if (loader === 'ts' || loader === 'tsx') {
    const loadedTsconfig = await loadTsconfigJsonForFile(filename)
    const loadedCompilerOptions = loadedTsconfig.compilerOptions ?? {}

    for (const field of meaningfulFields) {
      if (field in loadedCompilerOptions) {
        // @ts-ignore TypeScript can't tell they are of the same type
        compilerOptionsForFile[field] = loadedCompilerOptions[field]
      }
    }

    // align with TypeScript 4.3
    // https://github.com/microsoft/TypeScript/pull/42663
    if (loadedCompilerOptions.target?.toLocaleLowerCase() === 'esnext') {
      compilerOptionsForFile.useDefineForClassFields =
        loadedCompilerOptions.useDefineForClassFields ?? true
    }
  }

  const resolvedOptions = {
    loader: loader as Loader,
    sourcemap: true,
    // ensure source file name contains full query
    sourcefile: filename,
    tsconfigRaw: { compilerOptions: compilerOptionsForFile },
    ...options
  } as ESBuildOptions

  delete resolvedOptions.include
  delete resolvedOptions.exclude
  delete resolvedOptions.jsxInject

  try {
    const result = await transform(code, resolvedOptions)
    if (inMap) {
      const nextMap = JSON.parse(result.map)
      nextMap.sourcesContent = []
      return {
        ...result,
        map: combineSourcemaps(filename, [
          nextMap as RawSourceMap,
          inMap as RawSourceMap
        ]) as SourceMap
      }
    } else {
      return {
        ...result,
        map: JSON.parse(result.map)
      }
    }
  } catch (e) {
    debug(`esbuild error with options used: `, resolvedOptions)
    // patch error information
    if (e.errors) {
      e.frame = ''
      e.errors.forEach((m: Message) => {
        e.frame += `\n` + prettifyMessage(m, code)
      })
      e.loc = e.errors[0].location
    }
    throw e
  }
}

export function esbuildPlugin(options: ESBuildOptions = {}): Plugin {
  const filter = createFilter(
    options.include || /\.(tsx?|jsx)$/,
    options.exclude || /\.js$/
  )

  return {
    name: 'vite:esbuild',
    async transform(code, id) {
      if (filter(id) || filter(cleanUrl(id))) {
        const result = await transformWithEsbuild(code, id, options)
        if (result.warnings.length) {
          result.warnings.forEach((m) => {
            this.warn(prettifyMessage(m, code))
          })
        }
        if (options.jsxInject && /\.(?:j|t)sx\b/.test(id)) {
          result.code = options.jsxInject + ';' + result.code
        }
        return {
          code: result.code,
          map: result.map
        }
      }
    }
  }
}

export const buildEsbuildPlugin = (config: ResolvedConfig): Plugin => {
  return {
    name: 'vite:esbuild-transpile',
    async renderChunk(code, chunk, opts) {
      // @ts-ignore injected by @vitejs/plugin-legacy
      if (opts.__vite_skip_esbuild__) {
        return null
      }

      const target = config.build.target
      const minify = config.build.minify === 'esbuild'
      if ((!target || target === 'esnext') && !minify) {
        return null
      }
      return transformWithEsbuild(code, chunk.fileName, {
        target: target || undefined,
        minify
      })
    }
  }
}

function prettifyMessage(m: Message, code: string): string {
  let res = chalk.yellow(m.text)
  if (m.location) {
    const lines = code.split(/\r?\n/g)
    const line = Number(m.location.line)
    const column = Number(m.location.column)
    const offset =
      lines
        .slice(0, line - 1)
        .map((l) => l.length)
        .reduce((total, l) => total + l + 1, 0) + column
    res += `\n` + generateCodeFrame(code, offset, offset + 1)
  }
  return res + `\n`
}
