import {
  addFile,
  editFile,
  isBuild,
  removeFile,
  untilUpdated
} from '../../testUtils'

const filteredResult = {
  './foo.js': {
    msg: 'foo'
  }
}

// json exports key order is altered during build, but it doesn't matter in
// terms of behavior since module exports are not ordered anyway
const json = isBuild
  ? {
      msg: 'baz',
      default: {
        msg: 'baz'
      }
    }
  : {
      default: {
        msg: 'baz'
      },
      msg: 'baz'
    }

const allResult = {
  // JSON file should be properly transformed
  '/dir/baz.json': json,
  '/dir/foo.js': {
    msg: 'foo'
  },
  '/dir/index.js': {
    modules: filteredResult
  },
  '/dir/nested/bar.js': {
    modules: {
      '../baz.json': json
    },
    msg: 'bar'
  }
}

test('should work', async () => {
  expect(await page.textContent('.result')).toBe(
    JSON.stringify(allResult, null, 2)
  )
})

test('unassigned import processes', async () => {
  expect(await page.textContent('.side-effect-result')).toBe(
    'Hello from side effect'
  )
})

if (!isBuild) {
  test('hmr for adding/removing files', async () => {
    addFile('dir/a.js', '')
    await untilUpdated(
      () => page.textContent('.result'),
      JSON.stringify(
        {
          '/dir/a.js': {},
          ...allResult,
          '/dir/index.js': {
            modules: {
              './a.js': {},
              ...allResult['/dir/index.js'].modules
            }
          }
        },
        null,
        2
      )
    )

    // edit the added file
    editFile('dir/a.js', () => 'export const msg ="a"')
    await untilUpdated(
      () => page.textContent('.result'),
      JSON.stringify(
        {
          '/dir/a.js': {
            msg: 'a'
          },
          ...allResult,
          '/dir/index.js': {
            modules: {
              './a.js': {
                msg: 'a'
              },
              ...allResult['/dir/index.js'].modules
            }
          }
        },
        null,
        2
      )
    )

    removeFile('dir/a.js')
    await untilUpdated(
      () => page.textContent('.result'),
      JSON.stringify(allResult, null, 2)
    )
  })
}
