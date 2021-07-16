// test utils used in e2e tests for playgrounds.
// this can be directly imported in any playground tests as 'testUtils', e.g.
// `import { getColor } from 'testUtils'`

import fs from 'fs'
import path from 'path'
import colors from 'css-color-names'
import { ElementHandle } from 'playwright-chromium'

export function slash(p: string): string {
  return p.replace(/\\/g, '/')
}

export const isBuild = !!process.env.VITE_TEST_BUILD

const testPath = expect.getState().testPath
const testName = slash(testPath).match(/playground\/([\w-]+)\//)?.[1]
export const testDir = path.resolve(__dirname, '../../temp', testName)

const hexToNameMap: Record<string, string> = {}
Object.keys(colors).forEach((color) => {
  hexToNameMap[colors[color]] = color
})

function componentToHex(c: number): string {
  const hex = c.toString(16)
  return hex.length === 1 ? '0' + hex : hex
}

function rgbToHex(rgb: string): string {
  const match = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  if (match) {
    const [_, rs, gs, bs] = match
    return (
      '#' +
      componentToHex(parseInt(rs, 10)) +
      componentToHex(parseInt(gs, 10)) +
      componentToHex(parseInt(bs, 10))
    )
  } else {
    return '#000000'
  }
}

const timeout = (n: number) => new Promise((r) => setTimeout(r, n))

async function toEl(el: string | ElementHandle): Promise<ElementHandle> {
  if (typeof el === 'string') {
    return await page.$(el)
  }
  return el
}

export async function getColor(el: string | ElementHandle) {
  el = await toEl(el)
  const rgb = await el.evaluate((el) => getComputedStyle(el as Element).color)
  return hexToNameMap[rgbToHex(rgb)] || rgb
}

export async function getBg(el: string | ElementHandle) {
  el = await toEl(el)
  return el.evaluate((el) => getComputedStyle(el as Element).backgroundImage)
}

export function readFile(filename: string) {
  return fs.readFileSync(path.resolve(testDir, filename), 'utf-8')
}

export function editFile(
  filename: string,
  replacer: (str: string) => string,
  runInBuild: boolean = false
): void {
  if (isBuild && !runInBuild) return
  filename = path.resolve(testDir, filename)
  const content = fs.readFileSync(filename, 'utf-8')
  const modified = replacer(content)
  fs.writeFileSync(filename, modified)
}

export function addFile(filename: string, content: string) {
  fs.writeFileSync(path.resolve(testDir, filename), content)
}

export function removeFile(filename: string) {
  fs.unlinkSync(path.resolve(testDir, filename))
}

export function listAssets(base = '') {
  const assetsDir = path.join(testDir, 'dist', base, 'assets')
  return fs.readdirSync(assetsDir)
}

export function findAssetFile(match: string | RegExp, base = '') {
  const assetsDir = path.join(testDir, 'dist', base, 'assets')
  const files = fs.readdirSync(assetsDir)
  const file = files.find((file) => {
    return file.match(match)
  })
  return file ? fs.readFileSync(path.resolve(assetsDir, file), 'utf-8') : ''
}

export function readManifest(base = '') {
  return JSON.parse(
    fs.readFileSync(path.join(testDir, 'dist', base, 'manifest.json'), 'utf-8')
  )
}

/**
 * Poll a getter until the value it returns includes the expected value.
 */
export async function untilUpdated(
  poll: () => string | Promise<string>,
  expected: string,
  runInBuild = false
) {
  if (isBuild && !runInBuild) return
  const maxTries = process.env.CI ? 100 : 50
  for (let tries = 0; tries < maxTries; tries++) {
    const actual = (await poll()) || ''
    if (actual.indexOf(expected) > -1 || tries === maxTries - 1) {
      expect(actual).toMatch(expected)
      break
    } else {
      await timeout(50)
    }
  }
}

export async function autoRetry(
  test: () => void | Promise<void>
): Promise<void> {
  const timeout = 60 * 1000
  const period = 100
  const numberOfTries = timeout / period
  let i = 0
  while (true) {
    try {
      await test()
      return
    } catch (err) {
      i = i + 1
      if (i > numberOfTries) {
        throw err
      }
    }
    await sleep(period)
  }

  return

  function sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) =>
      setTimeout(() => {
        resolve()
      }, milliseconds)
    )
  }
}

/**
 * Send the rebuild complete message in build watch
 */
export { notifyRebuildComplete } from '../../scripts/jestPerTestSetup'
