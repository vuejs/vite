import { scriptRE, commentRE, importsRE } from '../optimizer/scan'

describe('optimizer-scan:script-test', () => {
  const scriptContent = `import { defineComponent } from 'vue'
      import ScriptDevelopPane from './ScriptDevelopPane.vue';
      export default defineComponent({
        components: {
          ScriptDevelopPane
        }
      })`

  test('component return value test', () => {
    scriptRE.lastIndex = 0
    const [, tsOpenTag, tsContent] = scriptRE.exec(
      `<script lang="ts">${scriptContent}</script>`
    )
    expect(tsOpenTag).toEqual('<script lang="ts">')
    expect(tsContent).toEqual(scriptContent)

    scriptRE.lastIndex = 0
    const [, openTag, content] = scriptRE.exec(
      `<script>${scriptContent}</script>`
    )
    expect(openTag).toEqual('<script>')
    expect(content).toEqual(scriptContent)
  })

  test('include comments test', () => {
    scriptRE.lastIndex = 0
    const ret = scriptRE.exec(
      `<template>
        <!--  <script >var test = null</script> -->
      </template>`.replace(commentRE, '')
    )
    expect(ret).toEqual(null)
  })

  test('components with script keyword test', () => {
    scriptRE.lastIndex = 0
    let ret = scriptRE.exec(`<template><script-develop-pane/></template>`)
    expect(ret).toBe(null)

    scriptRE.lastIndex = 0
    ret = scriptRE.exec(
      `<template><script-develop-pane></script-develop-pane></template>`
    )
    expect(ret).toBe(null)

    scriptRE.lastIndex = 0
    ret = scriptRE.exec(
      `<template><script-develop-pane  > content </script-develop-pane></template>`
    )
    expect(ret).toBe(null)
  })

  test('ordinary script tag test', () => {
    scriptRE.lastIndex = 0
    const [, tag, content] = scriptRE.exec(`<script  >var test = null</script>`)
    expect(tag).toEqual('<script  >')
    expect(content).toEqual('var test = null')

    scriptRE.lastIndex = 0
    const [, tag1, content1] = scriptRE.exec(`<script>var test = null</script>`)
    expect(tag1).toEqual('<script>')
    expect(content1).toEqual('var test = null')
  })

  test('imports regex should work', () => {
    const shouldMatchArray = [
      `import 'vue'`,
      `import { foo } from 'vue'`,
      `import foo from 'vue'`,
      `;import foo from 'vue'`,
      `   import foo from 'vue'`,
      `import { foo
      } from 'vue'`,
      `import bar, { foo } from 'vue'`,
      `import foo from 'vue';`,
      `*/ import foo from 'vue';`,
      `import foo from 'vue';//comment`,
      `import foo from 'vue';/*comment
      */`
      // Skipped, false negatives with current regex
      // `import typescript from 'typescript'`,
      // import type, {foo} from 'vue'
    ]

    shouldMatchArray.forEach((str) => {
      importsRE.lastIndex = 0
      expect(importsRE.exec(str)[1]).toEqual("'vue'")
    })

    const shouldFailArray = [
      `testMultiline("import", {
        body: "ok" });`,
      `//;import foo from 'vue'`,
      `import type { Bar } from 'foo'`,
      `import type{ Bar } from 'foo'`,
      `import type Bar from 'foo'`
    ]
    shouldFailArray.forEach((str) => {
      expect(importsRE.test(str)).toBe(false)
    })
  })
})
