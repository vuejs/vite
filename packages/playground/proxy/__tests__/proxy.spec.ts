test('/router', async () => {
  const port = require('../vite.config.js').server.port
  const url = `http://localhost:${port}`
  await page.goto(url + '/')
  expect(await page.textContent('.app')).toMatch('router')
})
