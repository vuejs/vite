import { readFile, untilUpdated, isBuild } from '../../testUtils'

test('should work', async () => {
  await page.click('.clickme')
  await untilUpdated(() => page.textContent('.content'), '3', true)
})

if (isBuild) {
  test('should have relative path', async () => {
    expect(readFile('dist/foo/assets/index.js')).toMatch(
      /.*\.\/assets\/preload\.js.*/
    )
  })
}
