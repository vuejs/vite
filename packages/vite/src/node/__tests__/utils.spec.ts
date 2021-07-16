import { injectQuery, isJSRequest, isWindows } from '../utils'

describe('injectQuery', () => {
  if (isWindows) {
    // this test will work incorrectly on unix systems
    test('normalize windows path', () => {
      expect(injectQuery('C:\\User\\Vite\\Project', 'direct')).toEqual(
        'C:/User/Vite/Project?direct'
      )
    })
  }

  test('path with multiple spaces', () => {
    expect(injectQuery('/usr/vite/path with space', 'direct')).toEqual(
      '/usr/vite/path with space?direct'
    )
  })

  test('path with multiple % characters', () => {
    expect(injectQuery('/usr/vite/not%20a%20space', 'direct')).toEqual(
      '/usr/vite/not%20a%20space?direct'
    )
  })

  test('path with %25', () => {
    expect(injectQuery('/usr/vite/%25hello%25', 'direct')).toEqual(
      '/usr/vite/%25hello%25?direct'
    )
  })

  test('path with unicode', () => {
    expect(injectQuery('/usr/vite/東京', 'direct')).toEqual(
      '/usr/vite/東京?direct'
    )
  })

  test('path with unicode, space, and %', () => {
    expect(injectQuery('/usr/vite/東京 %20 hello', 'direct')).toEqual(
      '/usr/vite/東京 %20 hello?direct'
    )
  })
})

describe('isJSRequest', () => {
  const knownJsSrcExtensions = ['.js', '.ts']
  test.each([
    ['', true], // bare imports are js
    ['.js', true],
    ['.ts', true],
    ['.x', false], // not in extensions list => false
    ['/', false] // directory => false
  ])('path ending with "%s" returns %s', (suffix, expected) => {
    const path = `/x/y/foo${suffix}`
    expect(isJSRequest(path, knownJsSrcExtensions)).toBe(expected)
    // also tests combinations of querystring and hash, must be the same result
    expect(isJSRequest(`${path}?foo=.js`, knownJsSrcExtensions)).toBe(expected)
    expect(isJSRequest(`${path}#.js`, knownJsSrcExtensions)).toBe(expected)
    expect(isJSRequest(`${path}?foo=.js#.js`, knownJsSrcExtensions)).toBe(
      expected
    )
    expect(isJSRequest(`${path}?foo=.x`, knownJsSrcExtensions)).toBe(expected)
    expect(isJSRequest(`${path}#.x`, knownJsSrcExtensions)).toBe(expected)
    expect(isJSRequest(`${path}?foo=.x#.x`, knownJsSrcExtensions)).toBe(
      expected
    )
  })
})
