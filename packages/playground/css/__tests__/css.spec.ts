import fs from 'fs'
import path from 'path'
import {
  editFile,
  findAssetFile,
  getBg,
  getColor,
  isBuild,
  removeFile,
  testDir,
  untilUpdated
} from '../../testUtils'

// note: tests should retrieve the element at the beginning of test and reuse it
// in later assertions to ensure CSS HMR doesn't reload the page

test('linked css', async () => {
  const linked = await page.$('.linked')
  const atImport = await page.$('.linked-at-import')

  expect(await getColor(linked)).toBe('blue')
  expect(await getColor(atImport)).toBe('red')

  editFile('linked.css', (code) => code.replace('color: blue', 'color: red'))
  await untilUpdated(() => getColor(linked), 'red')

  editFile('linked-at-import.css', (code) =>
    code.replace('color: red', 'color: blue')
  )
  await untilUpdated(() => getColor(atImport), 'blue')
})

test('css import from js', async () => {
  const imported = await page.$('.imported')
  const atImport = await page.$('.imported-at-import')

  expect(await getColor(imported)).toBe('green')
  expect(await getColor(atImport)).toBe('purple')

  editFile('imported.css', (code) => code.replace('color: green', 'color: red'))
  await untilUpdated(() => getColor(imported), 'red')

  editFile('imported-at-import.css', (code) =>
    code.replace('color: purple', 'color: blue')
  )
  await untilUpdated(() => getColor(atImport), 'blue')
})

test('postcss config', async () => {
  const imported = await page.$('.postcss .nesting')
  expect(await getColor(imported)).toBe('pink')

  editFile('imported.css', (code) => code.replace('color: pink', 'color: red'))
  await untilUpdated(() => getColor(imported), 'red')
})

test('sass', async () => {
  const imported = await page.$('.sass')
  const atImport = await page.$('.sass-at-import')
  const atImportAlias = await page.$('.sass-at-import-alias')
  const partialImport = await page.$('.sass-partial')

  expect(await getColor(imported)).toBe('orange')
  expect(await getColor(atImport)).toBe('olive')
  expect(await getBg(atImport)).toMatch(isBuild ? /base64/ : '/nested/icon.png')
  expect(await getColor(atImportAlias)).toBe('olive')
  expect(await getBg(atImportAlias)).toMatch(
    isBuild ? /base64/ : '/nested/icon.png'
  )
  expect(await getColor(partialImport)).toBe('orchid')

  editFile('sass.scss', (code) =>
    code.replace('color: $injectedColor', 'color: red')
  )
  await untilUpdated(() => getColor(imported), 'red')

  editFile('nested/_index.scss', (code) =>
    code.replace('color: olive', 'color: blue')
  )
  await untilUpdated(() => getColor(atImport), 'blue')

  editFile('nested/_partial.scss', (code) =>
    code.replace('color: orchid', 'color: green')
  )
  await untilUpdated(() => getColor(partialImport), 'green')
})

test('less', async () => {
  const imported = await page.$('.less')
  const atImport = await page.$('.less-at-import')
  const atImportAlias = await page.$('.less-at-import-alias')

  expect(await getColor(imported)).toBe('blue')
  expect(await getColor(atImport)).toBe('darkslateblue')
  expect(await getBg(atImport)).toMatch(isBuild ? /base64/ : '/nested/icon.png')
  expect(await getColor(atImportAlias)).toBe('darkslateblue')
  expect(await getBg(atImportAlias)).toMatch(
    isBuild ? /base64/ : '/nested/icon.png'
  )

  editFile('less.less', (code) => code.replace('@color: blue', '@color: red'))
  await untilUpdated(() => getColor(imported), 'red')

  editFile('nested/nested.less', (code) =>
    code.replace('color: darkslateblue', 'color: blue')
  )
  await untilUpdated(() => getColor(atImport), 'blue')
})

test('stylus', async () => {
  const imported = await page.$('.stylus')
  const additionalData = await page.$('.stylus-additional-data')
  const relativeImport = await page.$('.stylus-import')
  const relativeImportAlias = await page.$('.stylus-import-alias')
  const optionsRelativeImport = await page.$('.stylus-options-relative-import')
  const optionsAbsoluteImport = await page.$('.stylus-options-absolute-import')

  expect(await getColor(imported)).toBe('blue')
  expect(await getColor(additionalData)).toBe('orange')
  expect(await getColor(relativeImport)).toBe('darkslateblue')
  expect(await getColor(relativeImportAlias)).toBe('darkslateblue')
  expect(await getBg(relativeImportAlias)).toMatch(
    isBuild ? /base64/ : '/nested/icon.png'
  )
  expect(await getColor(optionsRelativeImport)).toBe('green')
  expect(await getColor(optionsAbsoluteImport)).toBe('red')

  editFile('stylus.styl', (code) =>
    code.replace('$color ?= blue', '$color ?= red')
  )
  await untilUpdated(() => getColor(imported), 'red')

  editFile('nested/nested.styl', (code) =>
    code.replace('color: darkslateblue', 'color: blue')
  )
  await untilUpdated(() => getColor(relativeImport), 'blue')
})

test('css modules', async () => {
  const imported = await page.$('.modules')
  expect(await getColor(imported)).toBe('turquoise')

  // check if the generated CSS module class name is indeed using the
  // format specified in vite.config.js
  expect(await imported.getAttribute('class')).toMatch(
    /.mod-module__apply-color___[\w-]{5}/
  )

  editFile('mod.module.css', (code) =>
    code.replace('color: turquoise', 'color: red')
  )
  await untilUpdated(() => getColor(imported), 'red')
})

test('css modules w/ sass', async () => {
  const imported = await page.$('.modules-sass')
  expect(await getColor(imported)).toBe('orangered')
  expect(await imported.getAttribute('class')).toMatch(
    /.mod-module__apply-color___[\w-]{5}/
  )

  editFile('mod.module.scss', (code) =>
    code.replace('color: orangered', 'color: blue')
  )
  await untilUpdated(() => getColor(imported), 'blue')
})

test('@import dependency w/ style entry', async () => {
  expect(await getColor('.css-dep')).toBe('purple')
})

test('@import dependency w/ sass entry', async () => {
  expect(await getColor('.css-dep-sass')).toBe('orange')
})

test('@import dependency w/ stylus entry', async () => {
  expect(await getColor('.css-dep-stylus')).toBe('red')
})

test('@import dependency w/out package scss', async () => {
  expect(await getColor('.sass-dep')).toBe('lavender')
})

test('async chunk', async () => {
  const el = await page.$('.async')
  expect(await getColor(el)).toBe('teal')

  if (isBuild) {
    // assert that the css is extracted into its own file instead of in the
    // main css file
    expect(findAssetFile(/index\.\w+\.css$/)).not.toMatch('teal')
    expect(findAssetFile(/async\.\w+\.css$/)).toMatch('.async{color:teal}')
  } else {
    // test hmr
    editFile('async.css', (code) => code.replace('color: teal', 'color: blue'))
    await untilUpdated(() => getColor(el), 'blue')
  }
})

test('treeshaken async chunk', async () => {
  if (isBuild) {
    // should be absent in prod
    expect(
      await page.evaluate(() => {
        return document.querySelector('.async-treeshaken')
      })
    ).toBeNull()
    // assert that the css is not present anywhere
    expect(findAssetFile(/\.css$/)).not.toMatch('plum')
    expect(findAssetFile(/index\.\w+\.js$/)).not.toMatch('.async{color:plum}')
    expect(findAssetFile(/async\.\w+\.js$/)).not.toMatch('.async{color:plum}')
    // should have no chunk!
    expect(findAssetFile(/async-treeshaken/)).toBe('')
  } else {
    // should be present in dev
    const el = await page.$('.async-treeshaken')
    editFile('async-treeshaken.css', (code) =>
      code.replace('color: plum', 'color: blue')
    )
    await untilUpdated(() => getColor(el), 'blue')
  }
})

test('PostCSS dir-dependency', async () => {
  const el1 = await page.$('.dir-dep')
  const el2 = await page.$('.dir-dep-2')

  expect(await getColor(el1)).toBe('grey')
  expect(await getColor(el2)).toBe('grey')

  if (!isBuild) {
    editFile('glob-dep/foo.css', (code) =>
      code.replace('color: grey', 'color: blue')
    )
    await untilUpdated(() => getColor(el1), 'blue')
    expect(await getColor(el2)).toBe('grey')

    editFile('glob-dep/bar.css', (code) =>
      code.replace('color: grey', 'color: red')
    )
    await untilUpdated(() => getColor(el2), 'red')
    expect(await getColor(el1)).toBe('blue')

    // test add/remove
    removeFile('glob-dep/bar.css')
    await untilUpdated(() => getColor(el2), 'black')
  }
})

test('Url separation', async () => {
  const urlSeparated = await page.$('.url-separated')
  const baseUrl = 'url(images/dog.webp)'
  const cases = new Array(5)
    .fill('')
    .flatMap((_, i) =>
      [',', ' ,', ', ', ' , '].map(
        (sep) => `background-image:${new Array(i + 1).fill(baseUrl).join(sep)};`
      )
    )

  // Insert the base case
  cases.unshift('background-image:url(images/cat.webp),url(images/dog.webp)')

  for (const [c, i] of cases.map((c, i) => [c, i]) as [string, number][]) {
    // Replace the previous case
    if (i > 0) editFile('imported.css', (code) => code.replace(cases[i - 1], c))

    expect(await getBg(urlSeparated)).toMatch(
      /^url\(.+\)(?:\s*,\s*url\(.+\))*$/
    )
  }
})
