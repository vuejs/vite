import { traverseHtml } from '../../plugins/html'
import { ssrTransform } from '../ssrTransform'

test('default import', async () => {
  expect(
    (
      await ssrTransform(
        `import foo from 'vue';console.log(foo.bar)`,
        null,
        null
      )
    ).code
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__(\\"vue\\");
    console.log(__vite_ssr_import_0__.default.bar)"
  `)
})

test('named import', async () => {
  expect(
    (
      await ssrTransform(
        `import { ref } from 'vue';function foo() { return ref(0) }`,
        null,
        null
      )
    ).code
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__(\\"vue\\");
    function foo() { return __vite_ssr_import_0__.ref(0) }"
  `)
})

test('namespace import', async () => {
  expect(
    (
      await ssrTransform(
        `import * as vue from 'vue';function foo() { return vue.ref(0) }`,
        null,
        null
      )
    ).code
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__(\\"vue\\");
    function foo() { return __vite_ssr_import_0__.ref(0) }"
  `)
})

test('export function declaration', async () => {
  expect((await ssrTransform(`export function foo() {}`, null, null)).code)
    .toMatchInlineSnapshot(`
    "function foo() {}
    Object.defineProperty(__vite_ssr_exports__, \\"foo\\", { enumerable: true, configurable: true, get(){ return foo }});"
  `)
})

test('export class declaration', async () => {
  expect((await ssrTransform(`export class foo {}`, null, null)).code)
    .toMatchInlineSnapshot(`
    "class foo {}
    Object.defineProperty(__vite_ssr_exports__, \\"foo\\", { enumerable: true, configurable: true, get(){ return foo }});"
  `)
})

test('export var declaration', async () => {
  expect((await ssrTransform(`export const a = 1, b = 2`, null, null)).code)
    .toMatchInlineSnapshot(`
    "const a = 1, b = 2
    Object.defineProperty(__vite_ssr_exports__, \\"a\\", { enumerable: true, configurable: true, get(){ return a }});
    Object.defineProperty(__vite_ssr_exports__, \\"b\\", { enumerable: true, configurable: true, get(){ return b }});"
  `)
})

test('export named', async () => {
  expect(
    (await ssrTransform(`const a = 1, b = 2; export { a, b as c }`, null, null))
      .code
  ).toMatchInlineSnapshot(`
    "const a = 1, b = 2; 
    Object.defineProperty(__vite_ssr_exports__, \\"a\\", { enumerable: true, configurable: true, get(){ return a }});
    Object.defineProperty(__vite_ssr_exports__, \\"c\\", { enumerable: true, configurable: true, get(){ return b }});"
  `)
})

test('export named from', async () => {
  expect(
    (await ssrTransform(`export { ref, computed as c } from 'vue'`, null, null))
      .code
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__(\\"vue\\");

    Object.defineProperty(__vite_ssr_exports__, \\"ref\\", { enumerable: true, configurable: true, get(){ return __vite_ssr_import_0__.ref }});
    Object.defineProperty(__vite_ssr_exports__, \\"c\\", { enumerable: true, configurable: true, get(){ return __vite_ssr_import_0__.computed }});"
  `)
})

test('named exports of imported binding', async () => {
  expect(
    (
      await ssrTransform(
        `import {createApp} from 'vue';export {createApp}`,
        null,
        null
      )
    ).code
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__(\\"vue\\");

    Object.defineProperty(__vite_ssr_exports__, \\"createApp\\", { enumerable: true, configurable: true, get(){ return __vite_ssr_import_0__.createApp }});"
  `)
})

test('export * from', async () => {
  expect(
    (
      await ssrTransform(
        `export * from 'vue'\n` + `export * from 'react'`,
        null,
        null
      )
    ).code
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__(\\"vue\\");
    __vite_ssr_exportAll__(__vite_ssr_import_0__);
    const __vite_ssr_import_1__ = await __vite_ssr_import__(\\"react\\");
    __vite_ssr_exportAll__(__vite_ssr_import_1__);"
  `)
})

test('export * as from', async () => {
  expect((await ssrTransform(`export * as foo from 'vue'`, null, null)).code)
    .toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__(\\"vue\\");

    Object.defineProperty(__vite_ssr_exports__, \\"foo\\", { enumerable: true, configurable: true, get(){ return __vite_ssr_import_0__ }});"
  `)
})

test('export default', async () => {
  expect(
    (await ssrTransform(`export default {}`, null, null)).code
  ).toMatchInlineSnapshot(`"__vite_ssr_exports__.default = {}"`)
})

test('import.meta', async () => {
  expect(
    (await ssrTransform(`console.log(import.meta.url)`, null, null)).code
  ).toMatchInlineSnapshot(`"console.log(__vite_ssr_import_meta__.url)"`)
})

test('dynamic import', async () => {
  expect(
    (await ssrTransform(`export const i = () => import('./foo')`, null, null))
      .code
  ).toMatchInlineSnapshot(`
    "const i = () => __vite_ssr_dynamic_import__('./foo')
    Object.defineProperty(__vite_ssr_exports__, \\"i\\", { enumerable: true, configurable: true, get(){ return i }});"
  `)
})

test('do not rewrite method definition', async () => {
  expect(
    (
      await ssrTransform(
        `import { fn } from 'vue';class A { fn() { fn() } }`,
        null,
        null
      )
    ).code
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__(\\"vue\\");
    class A { fn() { __vite_ssr_import_0__.fn() } }"
  `)
})

test('do not rewrite catch clause', async () => {
  expect(
    (
      await ssrTransform(
        `import {error} from './dependency';try {} catch(error) {}`,
        null,
        null
      )
    ).code
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__(\\"./dependency\\");
    try {} catch(error) {}"
  `)
})

// #2221
test('should declare variable for imported super class', async () => {
  expect(
    (
      await ssrTransform(
        `import { Foo } from './dependency';` + `class A extends Foo {}`,
        null,
        null
      )
    ).code
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__(\\"./dependency\\");
    const Foo = __vite_ssr_import_0__.Foo;
    class A extends Foo {}"
  `)

  // exported classes: should prepend the declaration at root level, before the
  // first class that uses the binding
  expect(
    (
      await ssrTransform(
        `import { Foo } from './dependency';` +
          `export default class A extends Foo {}\n` +
          `export class B extends Foo {}`,
        null,
        null
      )
    ).code
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__(\\"./dependency\\");
    const Foo = __vite_ssr_import_0__.Foo;
    class A extends Foo {}
    class B extends Foo {}
    Object.defineProperty(__vite_ssr_exports__, \\"default\\", { enumerable: true, value: A });
    Object.defineProperty(__vite_ssr_exports__, \\"B\\", { enumerable: true, configurable: true, get(){ return B }});"
  `)
})

// #4049
test('should handle default export variants', async () => {
  // default anonymous functions
  expect(
    (await ssrTransform(`export default function() {}\n`, null, null)).code
  ).toMatchInlineSnapshot(`
    "__vite_ssr_exports__.default = function() {}
    "
  `)
  // default anonymous class
  expect((await ssrTransform(`export default class {}\n`, null, null)).code)
    .toMatchInlineSnapshot(`
    "__vite_ssr_exports__.default = class {}
    "
  `)
  // default named functions
  expect(
    (
      await ssrTransform(
        `export default function foo() {}\n` +
          `foo.prototype = Object.prototype;`,
        null,
        null
      )
    ).code
  ).toMatchInlineSnapshot(`
    "function foo() {}
    foo.prototype = Object.prototype;
    Object.defineProperty(__vite_ssr_exports__, \\"default\\", { enumerable: true, value: foo });"
  `)
  // default named classes
  expect(
    (
      await ssrTransform(
        `export default class A {}\n` + `export class B extends A {}`,
        null,
        null
      )
    ).code
  ).toMatchInlineSnapshot(`
    "class A {}
    class B extends A {}
    Object.defineProperty(__vite_ssr_exports__, \\"default\\", { enumerable: true, value: A });
    Object.defineProperty(__vite_ssr_exports__, \\"B\\", { enumerable: true, configurable: true, get(){ return B }});"
  `)
})

test('sourcemap source', async () => {
  expect(
    (await ssrTransform(`export const a = 1`, null, 'input.js')).map.sources
  ).toStrictEqual(['input.js'])
})

test('overwrite bindings', async () => {
  expect(
    (
      await ssrTransform(
        `import { inject } from 'vue';` +
          `const a = { inject }\n` +
          `const b = { test: inject }\n` +
          `function c() { const { test: inject } = { test: true }; console.log(inject) }\n` +
          `const d = inject \n` +
          `function f() {  console.log(inject) }\n` +
          `function e() { const { inject } = { inject: true } }\n` +
          `function g() { const f = () => { const inject = true }; console.log(inject) }\n`,
        null,
        null
      )
    ).code
  ).toMatchInlineSnapshot(`
    "const __vite_ssr_import_0__ = await __vite_ssr_import__(\\"vue\\");
    const a = { inject: __vite_ssr_import_0__.inject }
    const b = { test: __vite_ssr_import_0__.inject }
    function c() { const { test: inject } = { test: true }; console.log(inject) }
    const d = __vite_ssr_import_0__.inject 
    function f() {  console.log(__vite_ssr_import_0__.inject) }
    function e() { const { inject } = { inject: true } }
    function g() { const f = () => { const inject = true }; console.log(__vite_ssr_import_0__.inject) }
    "
  `)
})
