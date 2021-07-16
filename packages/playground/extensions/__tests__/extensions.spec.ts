test('should have no 404s', () => {
  browserLogs.forEach((msg) => {
    expect(msg).not.toMatch('404')
  })
})

test('not contain `.mjs`', async () => {
  let appHtml = await page.content()
  expect(appHtml).toMatch('Hello Vite!')
})
