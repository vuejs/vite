// @ts-check
import fs from 'fs'

export const runtimePublicPath = '/@react-refresh'

const runtimeFilePath = require.resolve(
  'react-refresh/cjs/react-refresh-runtime.development.js'
)

export const runtimeCode = `
const exports = {}
${fs.readFileSync(runtimeFilePath, 'utf-8')}
function debounce(fn, delay) {
  let handle
  return () => {
    clearTimeout(handle)
    handle = setTimeout(fn, delay)
  }
}
exports.performReactRefresh = debounce(exports.performReactRefresh, 16)
export default exports
`

export const preambleCode = `
import RefreshRuntime from "__BASE__${runtimePublicPath.slice(1)}"
RefreshRuntime.injectIntoGlobalHook(window)
window.$RefreshReg$ = () => {}
window.$RefreshSig$ = () => (type) => type
window.__vite_plugin_react_preamble_installed__ = true
`

const header = `
import RefreshRuntime from "${runtimePublicPath}";

let prevRefreshReg;
let prevRefreshSig;

if (!window.__vite_plugin_react_preamble_installed__) {
  throw new Error(
    "@vitejs/plugin-react-refresh can't detect preamble. Something is wrong. " +
    "See https://github.com/vitejs/vite-plugin-react/pull/11#discussion_r430879201"
  );
}

if (import.meta.hot) {
  prevRefreshReg = window.$RefreshReg$;
  prevRefreshSig = window.$RefreshSig$;
  window.$RefreshReg$ = (type, id) => {
    RefreshRuntime.register(type, __SOURCE__ + " " + id)
  };
  window.$RefreshSig$ = RefreshRuntime.createSignatureFunctionForTransform;
}`.replace(/[\n]+/gm, '')

const footer = `
if (import.meta.hot) {
  window.$RefreshReg$ = prevRefreshReg;
  window.$RefreshSig$ = prevRefreshSig;

  __ACCEPT__
  if (!window.__vite_plugin_react_timeout) {
    window.__vite_plugin_react_timeout = setTimeout(() => {
      window.__vite_plugin_react_timeout = 0;
      RefreshRuntime.performReactRefresh();
    }, 30);
  }
}`

export function addRefreshWrapper(code, id, accept) {
  return (
    header.replace('__SOURCE__', JSON.stringify(id)) +
    code +
    footer.replace('__ACCEPT__', accept ? 'import.meta.hot.accept();' : '')
  )
}

/**
 * @param {import('@babel/core').BabelFileResult['ast']} ast
 */
export function isRefreshBoundary(ast) {
  // Every export must be a React component.
  return ast.program.body.every((node) => {
    if (node.type !== 'ExportNamedDeclaration') {
      return true
    }
    const { declaration, specifiers } = node
    if (declaration) {
      if (declaration.type === 'VariableDeclaration') {
        return declaration.declarations.every((variable) =>
          isComponentLikeIdentifier(variable.id)
        )
      }
      if (declaration.type === 'FunctionDeclaration') {
        return isComponentLikeIdentifier(declaration.id)
      }
    }
    return specifiers.every((spec) => {
      return isComponentLikeIdentifier(spec.exported)
    })
  })
}

/**
 * @param {import('@babel/types').Node} node
 */
function isComponentLikeIdentifier(node) {
  return node.type === 'Identifier' && isComponentLikeName(node.name)
}

/**
 * @param {string} name
 */
function isComponentLikeName(name) {
  return typeof name === 'string' && name[0] >= 'A' && name[0] <= 'Z'
}
