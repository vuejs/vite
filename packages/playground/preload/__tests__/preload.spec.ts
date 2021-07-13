import { isBuild } from '../../testUtils'
import { port } from './serve'
const url = `http://localhost:${port}`

test('dynamic import', async () => {
  await page.goto(url)
  // should have no 404s
  browserLogs.forEach((msg) => {
    expect(msg).not.toMatch('404')
  })

  const appHtml = await page.content()
  expect(await page.textContent('h1')).toMatch('Home')
})

if (isBuild) {
  test('preload on', async () => {
    await page.goto(url)
    let appHtml = await page.content()
    expect(appHtml).not.toMatch(
      /link rel="modulepreload".*?href="\/assets\/About\.\w{8}\.js"/
    )
    // after click button, we will run `__vitePreload` method and insert a modulepreload.
    await page.click('a[href="/about"]')
    appHtml = await page.content()
    expect(appHtml).toMatch(
      /link rel="modulepreload".*?href="\/assets\/About\.\w{8}\.js"/
    )
  })
} else {
  test('preload off', async () => {
    await page.goto(url)
    let appHtml = await page.content()
    expect(appHtml).not.toMatch(
      /link rel="modulepreload".*?href="\/assets\/About\.\w{8}\.js"/
    )
    await page.click('a[href="/about"]')
    appHtml = await page.content()
    expect(appHtml).not.toMatch(
      /link rel="modulepreload".*?href="\/assets\/About\.\w{8}\.js"/
    )
  })
}
