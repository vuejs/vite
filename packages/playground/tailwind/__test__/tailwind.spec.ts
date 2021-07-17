import { isBuild, editFile, untilUpdated, getColor } from '../../testUtils'

test('should render', async () => {
  expect(await page.textContent('#pagetitle')).toBe('|Page title|')
})

if (!isBuild) {
  test('regenerate CSS and HMR', async () => {
    browserLogs.length = 0
    const el = await page.$('#pagetitle')
    const el2 = await page.$('#helloroot')

    expect(await getColor(el)).toBe('rgb(11, 22, 33)')

    editFile('src/views/Page.vue', (code) =>
      code.replace('|Page title|', '|Page title updated|')
    )
    await untilUpdated(() => el.textContent(), '|Page title updated|')

    expect(browserLogs).toMatchObject([
      '[vite] css hot updated: /index.css',
      '[vite] hot updated: /src/views/Page.vue'
    ])

    browserLogs.length = 0

    editFile('src/components/HelloWorld.vue', (code) =>
      code.replace('text-gray-800', 'text-[rgb(10,20,30)]')
    )

    await untilUpdated(() => getColor(el2), 'rgb(10, 20, 30)')

    expect(browserLogs).toMatchObject([
      '[vite] css hot updated: /index.css',
      '[vite] hot updated: /src/components/HelloWorld.vue'
    ])

    browserLogs.length = 0
  })
}
