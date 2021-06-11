import type { PluginItem, types as t } from '@babel/core'

type RestoredJSX = [result: t.File | null | undefined, isCommonJS: boolean]

let babelRestoreJSX: Promise<PluginItem> | undefined

/** Restore JSX from `React.createElement` calls */
export async function restoreJSX(
  babel: typeof import('@babel/core'),
  code: string
): Promise<RestoredJSX> {
  const [reactAlias, isCommonJS] = parseReactAlias(code)
  const reactJsxRE = new RegExp(
    '\\b' + reactAlias + '\\.(createElement|Fragment)\\b',
    'g'
  )

  let hasCompiledJsx = false
  code = code.replace(reactJsxRE, (_, prop) => {
    hasCompiledJsx = true
    // Replace with "React" so JSX can be reverse compiled.
    return 'React.' + prop
  })

  if (!hasCompiledJsx) {
    return [null, false]
  }

  // Support modules that use `import {Fragment} from 'react'`
  code = code.replace(
    /createElement\(Fragment,/g,
    'createElement(React.Fragment,'
  )

  babelRestoreJSX ||= import('./babel-restore-jsx')

  const result = await babel.transformAsync(code, {
    ast: true,
    code: false,
    parserOpts: {
      plugins: ['jsx']
    },
    plugins: [await babelRestoreJSX]
  })

  return [result?.ast, isCommonJS]
}

function parseReactAlias(
  code: string
): [alias: string | undefined, isCommonJS: boolean] {
  let match = code.match(
    /\b(var|let|const) +(\w+) *= *require\(["']react["']\)/
  )
  if (match) {
    return [match[2], true]
  }
  match = code.match(/^import (\w+).+? from ["']react["']/m)
  if (match) {
    return [match[1], false]
  }
  return [undefined, false]
}
