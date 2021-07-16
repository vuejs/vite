import { editFile, getBg, getColor, isBuild, untilUpdated } from 'testUtils'

test('should render', async () => {
  expect(await page.textContent('h1')).toMatch('Vue SFCs')
})

test('should update', async () => {
  expect(await page.textContent('.hmr-inc')).toMatch('count is 0')
  await page.click('.hmr-inc')
  expect(await page.textContent('.hmr-inc')).toMatch('count is 1')
})

test('template/script latest syntax support', async () => {
  expect(await page.textContent('.syntax')).toBe('baz')
})

test('should remove comments in prod', async () => {
  expect(await page.innerHTML('.comments')).toBe(isBuild ? `` : `<!--hello-->`)
})

test(':slotted', async () => {
  expect(await getColor('.slotted')).toBe('red')
})

test('scan deps from <script setup lang="ts">', async () => {
  expect(await page.textContent('.scan')).toBe('ok')
})

describe('pre-processors', () => {
  test('pug', async () => {
    expect(await page.textContent('p.pug')).toMatch(
      `This is rendered from <template lang="pug">`
    )
    // #1383 pug default doctype
    expect(await page.textContent('.pug-slot')).toMatch(`slot content`)
    editFile('PreProcessors.vue', (code) =>
      code.replace('Pre-Processors', 'Updated')
    )
    await untilUpdated(() => page.textContent('h2.pre-processors'), 'Updated')
  })

  test('scss', async () => {
    const el = await page.$('p.pug')
    expect(await getColor(el)).toBe('magenta')
    editFile('PreProcessors.vue', (code) =>
      code.replace('$color: magenta;', '$color: red;')
    )
    await untilUpdated(() => getColor(el), 'red')
  })

  test('less + scoped', async () => {
    const el = await page.$('p.pug-less')
    expect(await getColor(el)).toBe('green')
    editFile('PreProcessors.vue', (code) =>
      code.replace('@color: green;', '@color: blue;')
    )
    await untilUpdated(() => getColor(el), 'blue')
  })

  test('stylus + change lang', async () => {
    expect(await getColor('p.pug-stylus')).toBe('orange')
    editFile('PreProcessors.vue', (code) =>
      code
        .replace('<style lang="stylus">', '<style lang="scss">')
        .replace('color = orange', '$color: yellow;')
        .replace('color: color', '{ color: $color; }')
    )
    await untilUpdated(() => getColor('p.pug-stylus'), 'yellow')
    editFile('PreProcessors.vue', (code) =>
      code.replace('$color: yellow;', '$color: orange;')
    )
    await untilUpdated(() => getColor('p.pug-stylus'), 'orange')
  })
})

describe('css modules', () => {
  test('basic', async () => {
    expect(await getColor('.sfc-css-modules')).toBe('blue')
    editFile('CssModules.vue', (code) =>
      code.replace('color: blue;', 'color: red;')
    )
    await untilUpdated(() => getColor('.sfc-css-modules'), 'red')
  })

  test('with preprocessor + name', async () => {
    expect(await getColor('.sfc-css-modules-with-pre')).toBe('orange')
    editFile('CssModules.vue', (code) =>
      code.replace('color: orange;', 'color: blue;')
    )
    await untilUpdated(() => getColor('.sfc-css-modules-with-pre'), 'blue')
  })
})

describe('asset reference', () => {
  const assetMatch = isBuild
    ? /\/assets\/asset\.\w{8}\.png/
    : '/assets/asset.png'

  test('should not 404', () => {
    browserLogs.forEach((msg) => {
      expect(msg).not.toMatch('404')
    })
  })

  test('relative import', async () => {
    const el = await page.$('img.relative-import')
    expect(await el.evaluate((el) => (el as HTMLImageElement).src)).toMatch(
      assetMatch
    )
  })

  test('absolute import', async () => {
    const el = await page.$('img.relative-import')
    expect(await el.evaluate((el) => (el as HTMLImageElement).src)).toMatch(
      assetMatch
    )
  })

  test('absolute import from public dir', async () => {
    const el = await page.$('img.public-import')
    expect(await el.evaluate((el) => (el as HTMLImageElement).src)).toMatch(
      `/icon.png`
    )
  })

  test('svg fragment', async () => {
    const img = await page.$('.svg-frag')
    expect(await img.getAttribute('src')).toMatch(/svg#icon-heart-view$/)
  })

  test('relative url from <style>', async () => {
    const assetMatch = isBuild
      ? /\/assets\/asset\.\w{8}\.png/
      : '/assets/asset.png'
    expect(await getBg('.relative-style-url')).toMatch(assetMatch)
  })
})

describe('hmr', () => {
  test('should re-render and preserve state when template is edited', async () => {
    editFile('Hmr.vue', (code) => code.replace('HMR', 'HMR updated'))
    await untilUpdated(() => page.textContent('h2.hmr'), 'HMR updated')
    expect(await page.textContent('.hmr-inc')).toMatch('count is 1')
  })

  test('should update style and preserve state when style is edited', async () => {
    expect(await getColor('.hmr-inc')).toBe('red')
    editFile('Hmr.vue', (code) => code.replace('color: red;', 'color: blue;'))
    await untilUpdated(() => getColor('.hmr-inc'), 'blue')
    expect(await page.textContent('.hmr-inc')).toMatch('count is 1')
  })

  test('should reload and reset state when script is edited', async () => {
    editFile('Hmr.vue', (code) =>
      code.replace('let foo: number = 0', 'let foo: number = 100')
    )
    await untilUpdated(() => page.textContent('.hmr-inc'), 'count is 100')
  })

  test('should re-render when template is emptied', async () => {
    editFile('Hmr.vue', () => '')
    await untilUpdated(() => page.innerHTML('.hmr-block'), '<!---->')
  })
})

describe('src imports', () => {
  test('script src with ts', async () => {
    expect(await page.textContent('.src-imports-script')).toMatch(
      'hello from script src'
    )
    editFile('src-import/script.ts', (code) =>
      code.replace('hello from script src', 'updated')
    )
    await untilUpdated(() => page.textContent('.src-imports-script'), 'updated')
  })

  test('style src', async () => {
    const el = await page.$('.src-imports-style')
    expect(await getColor(el)).toBe('tan')
    editFile('src-import/style.css', (code) =>
      code.replace('color: tan', 'color: red')
    )
    await untilUpdated(() => getColor(el), 'red')
  })

  test('tempalte src import hmr', async () => {
    const el = await page.$('.src-imports-style')
    editFile('src-import/template.html', (code) =>
      code.replace('should be tan', 'should be red')
    )
    await untilUpdated(() => el.textContent(), 'should be red')
  })
})

describe('custom blocks', () => {
  test('should work', async () => {
    expect(await page.textContent('.custom-block')).toMatch('こんにちは')
  })
})

describe('async component', () => {
  test('should work', async () => {
    expect(await page.textContent('.async-component')).toMatch('ab == ab')
  })
})
