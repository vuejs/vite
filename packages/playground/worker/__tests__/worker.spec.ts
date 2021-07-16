import fs from 'fs'
import path from 'path'
import { untilUpdated, isBuild, testDir } from '../../testUtils'
import { Page } from 'playwright-chromium'

test('normal', async () => {
  await page.click('.ping')
  await untilUpdated(() => page.textContent('.pong'), 'pong')
  await untilUpdated(
    () => page.textContent('.mode'),
    isBuild ? 'production' : 'development'
  )
})

test('inlined', async () => {
  await page.click('.ping-inline')
  await untilUpdated(() => page.textContent('.pong-inline'), 'pong')
})

const waitSharedWorkerTick = (
  (resolvedSharedWorkerCount: number) => async (page: Page) => {
    await untilUpdated(async () => {
      const count = await page.textContent('.tick-count')
      // ignore the initial 0
      return count === '1' ? 'page loaded' : ''
    }, 'page loaded')
    // test.concurrent sequential is not guaranteed
    // force page to wait to ensure two pages overlap in time
    resolvedSharedWorkerCount++
    if (resolvedSharedWorkerCount < 2) return

    await untilUpdated(() => {
      return resolvedSharedWorkerCount === 2 ? 'all pages loaded' : ''
    }, 'all pages loaded')
  }
)(0)

test.concurrent.each([[true], [false]])('shared worker', async (doTick) => {
  if (doTick) {
    await page.click('.tick-shared')
  }
  await waitSharedWorkerTick(page)
})

if (isBuild) {
  // assert correct files
  test('inlined code generation', async () => {
    const assetsDir = path.resolve(testDir, 'dist/assets')
    const files = fs.readdirSync(assetsDir)
    // should have 2 worker chunk
    expect(files.length).toBe(3)
    const index = files.find((f) => f.includes('index'))
    const content = fs.readFileSync(path.resolve(assetsDir, index), 'utf-8')
    const worker = files.find((f) => f.includes('my-worker'))
    const workerContent = fs.readFileSync(
      path.resolve(assetsDir, worker),
      'utf-8'
    )

    // worker should have all imports resolved and no exports
    expect(workerContent).not.toMatch(`import`)
    expect(workerContent).not.toMatch(`export`)
    // chunk
    expect(content).toMatch(`new Worker("/assets`)
    expect(content).toMatch(`new SharedWorker("/assets`)
    // inlined
    expect(content).toMatch(`.createObjectURL(`)
  })
}
