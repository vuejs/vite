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
  ignore?: string
  base: string
}> {
  const isEager = source.slice(pos, pos + 21) === 'import.meta.globEager'

  const err = (msg: string) => {
    const e = new Error(`Invalid glob import syntax: ${msg}`)
    ;(e as any).pos = pos
    return e
  }

  importer = cleanUrl(importer)
  const importerBasename = path.basename(importer)

  let [pattern, ignore, endIndex] = lexGlobPattern(source, pos)
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
    ignore: ['**/node_modules/**', ...(ignore ? [ignore] : [])]
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
      importsString += `import * as ${identifier} from ${JSON.stringify(
        importee
      )};`
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
    exp: `{${entries}}`,
    endIndex,
    isEager,
    pattern,
    ignore,
    base
  }
}

const enum LexerState {
  inCall,
  inSingleQuoteString,
  inDoubleQuoteString,
  inTemplateString,
  inComma
}

function lexGlobPattern(
  code: string,
  pos: number
): [string, string | undefined, number] {
  const startPos = code.indexOf(`(`, pos) + 1
  const [pattern, endIndexOfPattern] = lexString(code, startPos)
  const posOfIgnorePattern = findNextArgumentPos(code, endIndexOfPattern)
  const [ignore, endIndex] =
    posOfIgnorePattern === -1
      ? [undefined, endIndexOfPattern]
      : lexString(code, posOfIgnorePattern)

  return [pattern, ignore, code.indexOf(`)`, endIndex) + 1]
}

function lexString(code: string, pos: number): [string, number] {
  let state = LexerState.inCall
  let pattern = ''

  let i = pos
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
  return [pattern, i + 1]
}

// it will return -1 if not found next argument
function findNextArgumentPos(code: string, pos: number): number {
  let state: LexerState.inComma | undefined = undefined
  let i = pos
  outer: for (; i < code.length; i++) {
    const char = code.charAt(i)
    switch (state) {
      case undefined:
        if (char === ',') {
          state = LexerState.inComma
        } else if (char === ')') {
          i = -1
          break outer
        } else if (/\s/.test(char)) {
          continue
        } else {
          error(i)
        }
        break
      case LexerState.inComma:
        if (char === `'`) {
          break outer
        } else if (char === `"`) {
          break outer
        } else if (char === '`') {
          break outer
        } else if (/\s/.test(char)) {
          continue
        } else {
          error(i)
        }
        break
      default:
        throw new Error('unknown import.meta.glob lexer state')
    }
  }
  return i
}

function error(pos: number) {
  const err = new Error(
    `import.meta.glob() can only accept one or two string literals.`
  ) as RollupError
  err.pos = pos
  throw err
}
