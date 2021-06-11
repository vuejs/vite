import type { Visitor } from '@babel/core'
// eslint-disable-next-line node/no-extraneous-import
import type { ImportSpecifier } from '@babel/types'

/**
 * Replace this:
 *
 *     import { jsx as _jsx } from "react/jsx-runtime"
 *
 * with this:
 *
 *     var _jsx = require("react/jsx-runtime").jsx
 */
export function babelImportToRequire({
  types: t
}: typeof import('@babel/core')): {
  visitor: Visitor
} {
  return {
    visitor: {
      ImportDeclaration(path) {
        const decl = path.node
        const spec = decl.specifiers[0] as ImportSpecifier

        path.replaceWith(
          t.variableDeclaration('var', [
            t.variableDeclarator(
              spec.local,
              t.memberExpression(
                t.callExpression(t.identifier('require'), [decl.source]),
                spec.imported
              )
            )
          ])
        )
      }
    }
  }
}
