import fs from 'fs'
import path from 'path'
import { isBuild } from '../../testUtils'

if (isBuild) {
  test('outputs ESM', () => {
    const content = fs.readFileSync(
      path.join(__dirname, '..', 'dist', 'App.js'),
      'utf8'
    )
    expect(/^import/.test(content)).toBeTruthy()
  })
}
