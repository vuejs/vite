import path from 'path'
import glob from 'fast-glob'
import {
  isModernFlag,
  preloadMethod,
  preloadMarker
} from './plugins/importAnalysisBuild'
import { cleanUrl } from './utils'
import { RollupError } from 'rollup'

export async function transformImportGlob(
  source: string,
  pos: number,
  importer: string,
  importIndex: number,
  root: string,
  normalizeUrl?: (url: string, pos: number) => Promise<[string, string]>,
  ssr = false
): Promise<{
  importsString: string
  imports: string[]
  exp: string
  endIndex: number
  isEager: boolean
  pattern: string
  base: string
}> {
  const isEager = source.slice(pos, pos + 21) === 'import.meta.globEager'
  const isEagerDefault =
    isEager && source.slice(pos + 21, pos + 28) === 'Default'

  const err = (msg: string) => {
    const e = new Error(`Invalid glob import syntax: ${msg}`)
    ;(e as any).pos = pos
    return e
  }

  importer = cleanUrl(importer)
  const importerBasename = path.basename(importer)

  let [pattern, endIndex] = lexGlobPattern(source, pos)
  if (!pattern.startsWith('.') && !pattern.startsWith('/')) {
    throw err(`pattern must start with "." or "/" (relative to project root)`)
  }
  let base
  let parentDepth = 0
  const isAbsolute = pattern.startsWith('/')
  if (isAbsolute) {
    base = path.resolve(root)
    pattern = pattern.slice(1)
  } else {
    base = path.dirname(importer)
    while (pattern.startsWith('../')) {
      pattern = pattern.slice(3)
      base = path.resolve(base, '../')
      parentDepth++
    }
    if (pattern.startsWith('./')) {
      pattern = pattern.slice(2)
    }
  }
  const files = glob.sync(pattern, {
    cwd: base,
    ignore: ['**/node_modules/**']
  })
  const imports: string[] = []
  let importsString = ``
  let entries = ``
  for (let i = 0; i < files.length; i++) {
    // skip importer itself
    if (files[i] === importerBasename) continue
    const file = isAbsolute
      ? `/${files[i]}`
      : parentDepth
      ? `${'../'.repeat(parentDepth)}${files[i]}`
      : `./${files[i]}`
    let importee = file
    if (normalizeUrl) {
      ;[importee] = await normalizeUrl(file, pos)
    }
    imports.push(importee)
    const identifier = `__glob_${importIndex}_${i}`
    if (isEager) {
      importsString += `import ${
        isEagerDefault ? `` : `* as `
      }${identifier} from ${JSON.stringify(importee)};`
      entries += ` ${JSON.stringify(file)}: ${identifier},`
    } else {
      let imp = `import(${JSON.stringify(importee)})`
      if (!normalizeUrl && !ssr) {
        imp =
          `(${isModernFlag}` +
          `? ${preloadMethod}(()=>${imp},"${preloadMarker}")` +
          `: ${imp})`
      }
      entries += ` ${JSON.stringify(file)}: () => ${imp},`
    }
  }

  return {
    imports,
    importsString,
    exp: `Object.assign({${entries}})`,
    endIndex,
    isEager,
    pattern,
    base
  }
}

const enum LexerState {
  inCall,
  inSingleQuoteString,
  inDoubleQuoteString,
  inTemplateString
}

function lexGlobPattern(code: string, pos: number): [string, number] {
  let state = LexerState.inCall
  let pattern = ''

  let i = code.indexOf(`(`, pos) + 1
  outer: for (; i < code.length; i++) {
    const char = code.charAt(i)
    switch (state) {
      case LexerState.inCall:
        if (char === `'`) {
          state = LexerState.inSingleQuoteString
        } else if (char === `"`) {
          state = LexerState.inDoubleQuoteString
        } else if (char === '`') {
          state = LexerState.inTemplateString
        } else if (/\s/.test(char)) {
          continue
        } else {
          error(i)
        }
        break
      case LexerState.inSingleQuoteString:
        if (char === `'`) {
          break outer
        } else {
          pattern += char
        }
        break
      case LexerState.inDoubleQuoteString:
        if (char === `"`) {
          break outer
        } else {
          pattern += char
        }
        break
      case LexerState.inTemplateString:
        if (char === '`') {
          break outer
        } else {
          pattern += char
        }
        break
      default:
        throw new Error('unknown import.meta.glob lexer state')
    }
  }
  return [pattern, code.indexOf(`)`, i) + 1]
}

function error(pos: number) {
  const err = new Error(
    `import.meta.glob() can only accept string literals.`
  ) as RollupError
  err.pos = pos
  throw err
}
