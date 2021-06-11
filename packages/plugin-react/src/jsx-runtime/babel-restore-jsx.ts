/**
 * https://github.com/flying-sheep/babel-plugin-transform-react-createelement-to-jsx
 * @license GNU General Public License v3.0
 */
import type { types as t } from '@babel/core'
import * as babel from '@babel/core'

/**
 * Visitor factory for babel, converting React.createElement(...) to <jsx ...>...</jsx>
 *
 * What we want to handle here is this CallExpression:
 *
 *     React.createElement(
 *       type: StringLiteral|Identifier|MemberExpression,
 *       [props: ObjectExpression|Expression],
 *       [...children: StringLiteral|Expression]
 *     )
 *
 * Any of those arguments might also be missing (undefined) and/or invalid.
 */
export default function ({ types: t }: typeof babel): babel.PluginObj {
  /**
   * Get a `JSXElement` from a `CallExpression`.
   * Returns `null` if this impossible.
   */
  function getJSXNode(node: t.Node): t.JSXElement | t.JSXFragment | null {
    if (!isReactCreateElement(node)) {
      return null
    }

    //nameNode and propsNode may be undefined, getJSX* need to handle that
    const [nameNode, propsNode, ...childNodes] = node.arguments

    const name = getJSXName(nameNode)
    if (name === null) {
      return null //name is required
    }

    const props = getJSXProps(propsNode)
    if (props === null) {
      return null //no props → [], invalid → null
    }

    const children = getJSXChildren(childNodes)
    if (children === null) {
      return null //no children → [], invalid → null
    }

    if (
      t.isJSXMemberExpression(name) &&
      t.isJSXIdentifier(name.object) &&
      name.object.name === 'React' &&
      name.property.name === 'Fragment'
    ) {
      return t.jsxFragment(
        t.jsxOpeningFragment(),
        t.jsxClosingFragment(),
        children
      )
    }

    // self-closing tag if no children
    const selfClosing = children.length === 0
    const startTag = t.jsxOpeningElement(
      name,
      props as (t.JSXAttribute | t.JSXSpreadAttribute)[],
      selfClosing
    )
    const endTag = selfClosing ? null : t.jsxClosingElement(name)

    return t.jsxElement(startTag, endTag, children, selfClosing)
  }

  /**
   * Get a JSXIdentifier or JSXMemberExpression from a Node of known type.
   * Returns null if a unknown node type, null or undefined is passed.
   */
  function getJSXName(
    node: t.Node
  ): t.JSXMemberExpression | t.JSXIdentifier | null {
    if (node == null) {
      return null
    }

    const name = getJSXIdentifier(node)
    if (name !== null) {
      return name
    }

    if (!t.isMemberExpression(node)) {
      return null
    }
    const object = getJSXName(node.object)
    const property = getJSXName(node.property)
    if (object === null || property === null) {
      return null
    }
    return t.jsxMemberExpression(object, property as t.JSXIdentifier)
  }

  /**
   * Get a array of JSX(Spread)Attribute from a props ObjectExpression.
   * Handles the _extends Expression babel creates from SpreadElement nodes.
   * Returns null if a validation error occurs.
   */
  function getJSXProps(node: t.Node): t.Node[] | null {
    if (node == null || isNullLikeNode(node)) {
      return []
    }

    if (
      t.isCallExpression(node) &&
      t.isIdentifier(node.callee, { name: '_extends' })
    ) {
      const props = node.arguments.map(getJSXProps)
      //if calling this recursively works, flatten.
      if (props.every((prop) => prop !== null)) {
        return props as unknown as t.Node[]
      }
    }

    if (!t.isObjectExpression(node) && t.isExpression(node))
      return [t.jsxSpreadAttribute(node)]

    if (!isPlainObjectExpression(node)) {
      return null
    }
    return node.properties.map((prop) =>
      t.isObjectProperty(prop)
        ? t.jsxAttribute(
            getJSXIdentifier(prop.key)!,
            getJSXAttributeValue(prop.value)
          )
        : t.jsxSpreadAttribute((prop as t.SpreadElement).argument)
    )
  }

  function getJSXChild(
    node: t.Node
  ):
    | t.JSXText
    | t.JSXElement
    | t.JSXFragment
    | t.JSXExpressionContainer
    | null {
    if (t.isStringLiteral(node)) {
      return t.jsxText(node.value)
    }
    if (isReactCreateElement(node)) {
      return getJSXNode(node)
    }
    if (t.isExpression(node)) {
      return t.jsxExpressionContainer(node)
    }
    return null
  }

  function getJSXChildren(
    nodes: t.Node[]
  ):
    | (t.JSXElement | t.JSXFragment | t.JSXExpressionContainer | t.JSXText)[]
    | null {
    const children = nodes
      .filter((node) => !isNullLikeNode(node))
      .map(getJSXChild)
    if (children.some((child) => child == null)) {
      return null
    }
    return children as unknown as (
      | t.JSXElement
      | t.JSXFragment
      | t.JSXExpressionContainer
      | t.JSXText
    )[]
  }

  function getJSXIdentifier(node: t.Node): t.JSXIdentifier | null {
    //TODO: JSXNamespacedName
    if (t.isIdentifier(node)) {
      return t.jsxIdentifier(node.name)
    }
    if (t.isStringLiteral(node)) {
      return t.jsxIdentifier(node.value)
    }
    return null
  }

  function getJSXAttributeValue(
    node: t.Node
  ): t.StringLiteral | t.JSXElement | t.JSXExpressionContainer | null {
    if (t.isStringLiteral(node)) {
      return node
    }
    if (t.isJSXElement(node)) {
      return node
    }
    if (t.isExpression(node)) {
      return t.jsxExpressionContainer(node)
    }
    return null
  }

  /**
   * Tests if a node is a CallExpression with callee `React.createElement`
   */
  const isReactCreateElement = (node: t.Node): node is t.CallExpression =>
    t.isCallExpression(node) &&
    t.isMemberExpression(node.callee) &&
    t.isIdentifier(node.callee.object, { name: 'React' }) &&
    t.isIdentifier(node.callee.property, { name: 'createElement' }) &&
    !node.callee.computed

  /**
   * Tests if a node is `null` or `undefined`
   */
  const isNullLikeNode = (node: t.Node): node is t.NullLiteral | t.Identifier =>
    t.isNullLiteral(node) || t.isIdentifier(node, { name: 'undefined' })

  /**
   * Tests if a node is an object expression with noncomputed, nonmethod attrs
   */
  const isPlainObjectExpression = (node: t.Node): node is t.ObjectExpression =>
    t.isObjectExpression(node) &&
    node.properties.every(
      (property) =>
        t.isSpreadElement(property) ||
        (t.isObjectProperty(property, { computed: false }) &&
          getJSXIdentifier(property.key) !== null &&
          getJSXAttributeValue(property.value) !== null)
    )

  return {
    visitor: {
      CallExpression(path) {
        const node = getJSXNode(path.node)
        if (node === null) {
          return null
        }
        path.replaceWith(node)
      }
    }
  }
}
