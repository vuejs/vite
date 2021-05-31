import type { NodePath } from '@babel/core'
import type { ImportDeclaration, ImportSpecifier } from '@babel/types'

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
}: typeof import('@babel/core')) {
  return {
    visitor: {
      ImportDeclaration(path: NodePath) {
        const decl = path.node as ImportDeclaration
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
