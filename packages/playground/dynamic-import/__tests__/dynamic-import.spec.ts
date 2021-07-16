import { isBuild, untilUpdated } from '../../testUtils'

test('should load literal dynamic import', async () => {
  await page.click('.baz')
  await untilUpdated(() => page.textContent('.view'), 'Baz view', true)
})

test('should load full dynamic import from public', async () => {
  await page.click('.qux')
  await untilUpdated(() => page.textContent('.view'), 'Qux view', true)
})

test('should load data URL of `blob:`', async () => {
  await page.click('.issue-2658-1')
  await untilUpdated(() => page.textContent('.view'), 'blob', true)
})

test('should load data URL of `data:`', async () => {
  await page.click('.issue-2658-2')
  await untilUpdated(() => page.textContent('.view'), 'data', true)
})

test('should have same reference on static and dynamic js import', async () => {
  await page.click('.mxd')
  await untilUpdated(() => page.textContent('.view'), 'true', true)
})

// in this case, it is not possible to detect the correct module
test('should have same reference on static and dynamic js import', async () => {
  await page.click('.mxd2')
  await untilUpdated(() => page.textContent('.view'), 'false', true)
})

test('should have same reference on static and dynamic js import', async () => {
  await page.click('.mxdjson')
  await untilUpdated(() => page.textContent('.view'), 'true', true)
})

// since this test has a timeout, it should be put last so that it
// does not bleed on the last
test('should load dynamic import with vars', async () => {
  await page.click('.foo')
  await untilUpdated(() => page.textContent('.view'), 'Foo view', true)

  await page.click('.bar')
  await untilUpdated(() => page.textContent('.view'), 'Bar view', true)
})

// dynamic import css
test('should load dynamic import with css', async () => {
  await page.click('.css')
  await untilUpdated(
    () => page.$eval('.css', (node) => window.getComputedStyle(node).boxSizing),
    'border-box',
    true
  )
})
