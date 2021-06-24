import { removeMapFileComments } from 'convert-source-map'
import MagicString from 'magic-string'
import { SourceMap } from 'rollup'
import { TransformResult } from '../server/transformRequest'
import { parser } from '../server/pluginContainer'
import {
  Identifier,
  Node as _Node,
  Property,
  Function as FunctionNode
} from 'estree'
import { extract_names as extractNames } from 'periscopic'
import { walk as eswalk } from 'estree-walker'
import { combineSourcemaps } from '../utils'
import { RawSourceMap } from '@ampproject/remapping/dist/types/types'

type Node = _Node & {
  start: number
  end: number
}

export const ssrModuleExportsKey = `__vite_ssr_exports__`
export const ssrImportKey = `__vite_ssr_import__`
export const ssrDynamicImportKey = `__vite_ssr_dynamic_import__`
export const ssrExportAllKey = `__vite_ssr_exportAll__`
export const ssrImportMetaKey = `__vite_ssr_import_meta__`

let offset: number
try {
  new Function('throw new Error(1)')()
} catch (e) {
  // in Node 12, stack traces account for the function wrapper.
  // in Node 13 and later, the function wrapper adds two lines,
  // which must be subtracted to generate a valid mapping
  const match = /:(\d+):\d+\)$/.exec(e.stack.split('\n')[1])
  offset = match ? +match[1] - 1 : 0
}

export async function ssrTransform(
  code: string,
  inMap: SourceMap | null,
  url: string,
  isProduction: boolean
): Promise<TransformResult | null> {
  const s = new MagicString(removeMapFileComments(code))

  // SSR modules are wrapped with `new Function()` before they're executed,
  // so we need to shift the line mappings. These empty lines are removed
  // before the module is wrapped.
  const lineOffset = isProduction ? offset : 1
  if (lineOffset > 0) {
    s.prependLeft(0, '\n'.repeat(lineOffset))
  }

  const ast = parser.parse(code, {
    sourceType: 'module',
    ecmaVersion: 2021,
    locations: true
  }) as any

  let uid = 0
  const deps = new Set<string>()
  const idToImportMap = new Map<string, string>()
  const declaredConst = new Set<string>()

  function defineImport(node: Node, source: string) {
    deps.add(source)
    const importId = `__vite_ssr_import_${uid++}__`
    s.appendLeft(
      node.start,
      `const ${importId} = ${ssrImportKey}(${JSON.stringify(source)})\n`
    )
    return importId
  }

  function defineExport(name: string, local = name) {
    s.append(
      `\nObject.defineProperty(${ssrModuleExportsKey}, "${name}", ` +
        `{ enumerable: true, configurable: true, get(){ return ${local} }})`
    )
  }

  // 1. check all import statements and record id -> importName map
  for (const node of ast.body as Node[]) {
    // import foo from 'foo' --> foo -> __import_foo__.default
    // import { baz } from 'foo' --> baz -> __import_foo__.baz
    // import * as ok from 'foo' --> ok -> __import_foo__
    if (node.type === 'ImportDeclaration') {
      const importId = defineImport(node, node.source.value as string)
      for (const spec of node.specifiers) {
        if (spec.type === 'ImportSpecifier') {
          idToImportMap.set(
            spec.local.name,
            `${importId}.${spec.imported.name}`
          )
        } else if (spec.type === 'ImportDefaultSpecifier') {
          idToImportMap.set(spec.local.name, `${importId}.default`)
        } else {
          // namespace specifier
          idToImportMap.set(spec.local.name, importId)
        }
      }
      s.remove(node.start, node.end)
    }
  }

  // 2. check all export statements and define exports
  for (const node of ast.body as Node[]) {
    // named exports
    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration) {
        if (
          node.declaration.type === 'FunctionDeclaration' ||
          node.declaration.type === 'ClassDeclaration'
        ) {
          // export function foo() {}
          defineExport(node.declaration.id!.name)
        } else {
          // export const foo = 1, bar = 2
          for (const declaration of node.declaration.declarations) {
            const names = extractNames(declaration.id as any)
            for (const name of names) {
              defineExport(name)
            }
          }
        }
        s.remove(node.start, (node.declaration as Node).start)
      } else if (node.source) {
        // export { foo, bar } from './foo'
        const importId = defineImport(node, node.source.value as string)
        for (const spec of node.specifiers) {
          defineExport(spec.exported.name, `${importId}.${spec.local.name}`)
        }
        s.remove(node.start, node.end)
      } else {
        // export { foo, bar }
        for (const spec of node.specifiers) {
          const local = spec.local.name
          const binding = idToImportMap.get(local)
          defineExport(spec.exported.name, binding || local)
        }
        s.remove(node.start, node.end)
      }
    }

    // default export
    if (node.type === 'ExportDefaultDeclaration') {
      s.overwrite(
        node.start,
        node.start + 14,
        `${ssrModuleExportsKey}.default =`
      )
    }

    // export * from './foo'
    if (node.type === 'ExportAllDeclaration') {
      const importId = defineImport(node, node.source.value as string)
      s.remove(node.start, node.end)
      s.append(`\n${ssrExportAllKey}(${importId})`)
    }
  }

  // 3. convert references to import bindings & import.meta references
  walk(ast, {
    onIdentifier(id, parent, parentStack) {
      const binding = idToImportMap.get(id.name)
      if (!binding) {
        return
      }
      if (isStaticProperty(parent) && parent.shorthand) {
        // let binding used in a property shorthand
        // { foo } -> { foo: __import_x__.foo }
        // skip for destructuring patterns
        if (
          !(parent as any).inPattern ||
          isInDestructuringAssignment(parent, parentStack)
        ) {
          s.appendLeft(id.end, `: ${binding}`)
        }
      } else if (
        parent.type === 'ClassDeclaration' &&
        id === parent.superClass
      ) {
        if (!declaredConst.has(id.name)) {
          declaredConst.add(id.name)
          // locate the top-most node containing the class declaration
          const topNode = parentStack[1]
          s.prependRight(topNode.start, `const ${id.name} = ${binding};\n`)
        }
      } else {
        s.overwrite(id.start, id.end, binding)
      }
    },
    onImportMeta(node) {
      s.overwrite(node.start, node.end, ssrImportMetaKey)
    },
    onDynamicImport(node) {
      s.overwrite(node.start, node.start + 6, ssrDynamicImportKey)
    }
  })

  let map = s.generateMap({
    hires: true,
    source: url,
    includeContent: true
  })

  if (inMap && inMap.mappings && inMap.sources.length > 0) {
    map = combineSourcemaps(url, [
      map as RawSourceMap,
      inMap as RawSourceMap
    ]) as SourceMap
  }

  return {
    code: s.toString().slice(lineOffset),
    map,
    deps: [...deps]
  }
}

interface Visitors {
  onIdentifier: (
    node: Identifier & {
      start: number
      end: number
    },
    parent: Node,
    parentStack: Node[]
  ) => void
  onImportMeta: (node: Node) => void
  onDynamicImport: (node: Node) => void
}

/**
 * Same logic from \@vue/compiler-core & \@vue/compiler-sfc
 * Except this is using acorn AST
 */
function walk(
  root: Node,
  { onIdentifier, onImportMeta, onDynamicImport }: Visitors
) {
  const parentStack: Node[] = []
  const scope: Record<string, number> = Object.create(null)
  const scopeMap = new WeakMap<_Node, Set<string>>()

  const setScope = (node: FunctionNode, name: string) => {
    let scopeIds = scopeMap.get(node)
    if (scopeIds && scopeIds.has(name)) {
      return
    }
    if (name in scope) {
      scope[name]++
    } else {
      scope[name] = 1
    }
    if (!scopeIds) {
      scopeIds = new Set()
      scopeMap.set(node, scopeIds)
    }
    scopeIds.add(name)
  }

  ;(eswalk as any)(root, {
    enter(node: Node, parent: Node | null) {
      if (node.type === 'ImportDeclaration') {
        return this.skip()
      }

      parent && parentStack.push(parent)

      if (node.type === 'MetaProperty' && node.meta.name === 'import') {
        onImportMeta(node)
      } else if (node.type === 'ImportExpression') {
        onDynamicImport(node)
      }

      if (node.type === 'Identifier') {
        if (!scope[node.name] && isRefIdentifier(node, parent!, parentStack)) {
          onIdentifier(node, parent!, parentStack)
        }
      } else if (isFunction(node)) {
        // walk function expressions and add its arguments to known identifiers
        // so that we don't prefix them
        node.params.forEach((p) =>
          (eswalk as any)(p, {
            enter(child: Node, parent: Node) {
              if (
                child.type === 'Identifier' &&
                // do not record as scope variable if is a destructuring key
                !isStaticPropertyKey(child, parent) &&
                // do not record if this is a default value
                // assignment of a destructuring variable
                !(
                  parent &&
                  parent.type === 'AssignmentPattern' &&
                  parent.right === child
                )
              ) {
                setScope(node, child.name)
              }
            }
          })
        )
      } else if (node.type === 'Property' && parent!.type === 'ObjectPattern') {
        // mark property in destructuring pattern
        ;(node as any).inPattern = true
      } else if (node.type === 'VariableDeclarator') {
        const parentFunction = findParentFunction(parentStack)
        if (parentFunction) {
          if (node.id.type === 'ObjectPattern') {
            node.id.properties.forEach((property) => {
              if (property.type === 'RestElement') {
                setScope(parentFunction, (property.argument as Identifier).name)
              } else {
                setScope(parentFunction, (property.value as Identifier).name)
              }
            })
          } else {
            setScope(parentFunction, (node.id as Identifier).name)
          }
        }
      }
    },

    leave(node: Node, parent: Node | null) {
      parent && parentStack.pop()
      const scopeIds = scopeMap.get(node)
      if (scopeIds) {
        scopeIds.forEach((id: string) => {
          scope[id]--
          if (scope[id] === 0) {
            delete scope[id]
          }
        })
      }
    }
  })
}

function isRefIdentifier(id: Identifier, parent: _Node, parentStack: _Node[]) {
  // declaration id
  if (
    parent.type === 'CatchClause' ||
    ((parent.type === 'VariableDeclarator' ||
      parent.type === 'ClassDeclaration') &&
      parent.id === id)
  ) {
    return false
  }

  if (isFunction(parent)) {
    // function declaration/expression id
    if ((parent as any).id === id) {
      return false
    }
    // params list
    if (parent.params.includes(id)) {
      return false
    }
  }

  // class method name
  if (parent.type === 'MethodDefinition') {
    return false
  }

  // property key
  // this also covers object destructuring pattern
  if (isStaticPropertyKey(id, parent) || (parent as any).inPattern) {
    return false
  }

  // non-assignment array destructuring pattern
  if (
    parent.type === 'ArrayPattern' &&
    !isInDestructuringAssignment(parent, parentStack)
  ) {
    return false
  }

  // member expression property
  if (
    parent.type === 'MemberExpression' &&
    parent.property === id &&
    !parent.computed
  ) {
    return false
  }

  if (parent.type === 'ExportSpecifier') {
    return false
  }

  // is a special keyword but parsed as identifier
  if (id.name === 'arguments') {
    return false
  }

  return true
}

const isStaticProperty = (node: _Node): node is Property =>
  node && node.type === 'Property' && !node.computed

const isStaticPropertyKey = (node: _Node, parent: _Node) =>
  isStaticProperty(parent) && parent.key === node

function isFunction(node: _Node): node is FunctionNode {
  return /Function(?:Expression|Declaration)$|Method$/.test(node.type)
}

function findParentFunction(parentStack: _Node[]): FunctionNode | undefined {
  for (const node of parentStack) {
    if (isFunction(node)) {
      return node
    }
  }
}

function isInDestructuringAssignment(
  parent: _Node,
  parentStack: _Node[]
): boolean {
  if (
    parent &&
    (parent.type === 'Property' || parent.type === 'ArrayPattern')
  ) {
    let i = parentStack.length
    while (i--) {
      const p = parentStack[i]
      if (p.type === 'AssignmentExpression') {
        return true
      } else if (p.type !== 'Property' && !p.type.endsWith('Pattern')) {
        break
      }
    }
  }
  return false
}
