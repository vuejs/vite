import { ssrTransform } from '../ssrTransform'

const transform = (code: string, url?: string, isProduction = false) =>
  ssrTransform(code, null, url, isProduction)

test('default import', async () => {
  expect((await transform(`import foo from 'vue';console.log(foo.bar)`)).code)
    .toMatchInlineSnapshot(`
      "const __vite_ssr_import_0__ = __vite_ssr_import__(\\"vue\\")
      console.log(__vite_ssr_import_0__.default.bar)"
    `)
})

test('named import', async () => {
  expect(
    (
      await transform(
        `import { ref } from 'vue';function foo() { return ref(0) }`
      )
    ).code
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = __vite_ssr_import__(\\"vue\\")
    function foo() { return __vite_ssr_import_0__.ref(0) }"
  `)
})

test('namespace import', async () => {
  expect(
    (
      await transform(
        `import * as vue from 'vue';function foo() { return vue.ref(0) }`
      )
    ).code
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = __vite_ssr_import__(\\"vue\\")
    function foo() { return __vite_ssr_import_0__.ref(0) }"
  `)
})

test('export function declaration', async () => {
  expect((await transform(`export function foo() {}`)).code)
    .toMatchInlineSnapshot(`
      "function foo() {}
      Object.defineProperty(__vite_ssr_exports__, \\"foo\\", { enumerable: true, configurable: true, get(){ return foo }})"
    `)
})

test('export class declaration', async () => {
  expect((await transform(`export class foo {}`)).code).toMatchInlineSnapshot(`
    "class foo {}
    Object.defineProperty(__vite_ssr_exports__, \\"foo\\", { enumerable: true, configurable: true, get(){ return foo }})"
  `)
})

test('export var declaration', async () => {
  expect((await transform(`export const a = 1, b = 2`)).code)
    .toMatchInlineSnapshot(`
      "const a = 1, b = 2
      Object.defineProperty(__vite_ssr_exports__, \\"a\\", { enumerable: true, configurable: true, get(){ return a }})
      Object.defineProperty(__vite_ssr_exports__, \\"b\\", { enumerable: true, configurable: true, get(){ return b }})"
    `)
})

test('export named', async () => {
  expect((await transform(`const a = 1, b = 2; export { a, b as c }`)).code)
    .toMatchInlineSnapshot(`
      "const a = 1, b = 2; 
      Object.defineProperty(__vite_ssr_exports__, \\"a\\", { enumerable: true, configurable: true, get(){ return a }})
      Object.defineProperty(__vite_ssr_exports__, \\"c\\", { enumerable: true, configurable: true, get(){ return b }})"
    `)
})

test('export named from', async () => {
  expect((await transform(`export { ref, computed as c } from 'vue'`)).code)
    .toMatchInlineSnapshot(`
      "const __vite_ssr_import_0__ = __vite_ssr_import__(\\"vue\\")

      Object.defineProperty(__vite_ssr_exports__, \\"ref\\", { enumerable: true, configurable: true, get(){ return __vite_ssr_import_0__.ref }})
      Object.defineProperty(__vite_ssr_exports__, \\"c\\", { enumerable: true, configurable: true, get(){ return __vite_ssr_import_0__.computed }})"
    `)
})

test('named exports of imported binding', async () => {
  expect(
    (await transform(`import {createApp} from 'vue';export {createApp}`)).code
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = __vite_ssr_import__(\\"vue\\")

    Object.defineProperty(__vite_ssr_exports__, \\"createApp\\", { enumerable: true, configurable: true, get(){ return __vite_ssr_import_0__.createApp }})"
  `)
})

test('export * from', async () => {
  expect((await transform(`export * from 'vue'`)).code).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = __vite_ssr_import__(\\"vue\\")

    __vite_ssr_exportAll__(__vite_ssr_import_0__)"
  `)
})

test('export default', async () => {
  expect((await transform(`export default {}`)).code).toMatchInlineSnapshot(
    `"__vite_ssr_exports__.default = {}"`
  )
})

test('import.meta', async () => {
  expect(
    (await transform(`console.log(import.meta.url)`)).code
  ).toMatchInlineSnapshot(`"console.log(__vite_ssr_import_meta__.url)"`)
})

test('dynamic import', async () => {
  expect((await transform(`export const i = () => import('./foo')`)).code)
    .toMatchInlineSnapshot(`
      "const i = () => __vite_ssr_dynamic_import__('./foo')
      Object.defineProperty(__vite_ssr_exports__, \\"i\\", { enumerable: true, configurable: true, get(){ return i }})"
    `)
})

test('do not rewrite method definition', async () => {
  expect(
    (await transform(`import { fn } from 'vue';class A { fn() { fn() } }`)).code
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = __vite_ssr_import__(\\"vue\\")
    class A { fn() { __vite_ssr_import_0__.fn() } }"
  `)
})

test('do not rewrite catch clause', async () => {
  expect(
    (
      await transform(
        `import {error} from './dependency';try {} catch(error) {}`
      )
    ).code
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = __vite_ssr_import__(\\"./dependency\\")
    try {} catch(error) {}"
  `)
})

// #2221
test('should declare variable for imported super class', async () => {
  expect(
    (
      await transform(
        `import { Foo } from './dependency';` + `class A extends Foo {}`
      )
    ).code
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = __vite_ssr_import__(\\"./dependency\\")
    const Foo = __vite_ssr_import_0__.Foo;
    class A extends Foo {}"
  `)

  // exported classes: should prepend the declaration at root level, before the
  // first class that uses the binding
  expect(
    (
      await transform(
        `import { Foo } from './dependency';` +
          `export default class A extends Foo {}\n` +
          `export class B extends Foo {}`
      )
    ).code
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = __vite_ssr_import__(\\"./dependency\\")
    const Foo = __vite_ssr_import_0__.Foo;
    __vite_ssr_exports__.default = class A extends Foo {}
    class B extends Foo {}
    Object.defineProperty(__vite_ssr_exports__, \\"B\\", { enumerable: true, configurable: true, get(){ return B }})"
  `)
})

test('sourcemap source', async () => {
  expect(
    (await transform(`export const a = 1`, 'input.js')).map.sources
  ).toStrictEqual(['input.js'])
})

test('overwrite bindings', async () => {
  expect(
    (
      await transform(
        `import { inject } from 'vue';` +
          `const a = { inject }\n` +
          `const b = { test: inject }\n` +
          `function c() { const { test: inject } = { test: true }; console.log(inject) }\n` +
          `const d = inject \n` +
          `function f() {  console.log(inject) }\n` +
          `function e() { const { inject } = { inject: true } }\n`
      )
    ).code
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = __vite_ssr_import__(\\"vue\\")
    const a = { inject: __vite_ssr_import_0__.inject }
    const b = { test: __vite_ssr_import_0__.inject }
    function c() { const { test: inject } = { test: true }; console.log(inject) }
    const d = __vite_ssr_import_0__.inject 
    function f() {  console.log(__vite_ssr_import_0__.inject) }
    function e() { const { inject } = { inject: true } }
    "
  `)
})
