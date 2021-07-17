test('should respected each `tsconfig.json`s compilerOptions', () => {
  // main side effect should be called (because of `"importsNotUsedAsValues": "preserve"`)
  expect(browserLogs).toContain('main side effect')
  // main base setter should not be called (because of `"useDefineForClassFields": true"`)
  expect(browserLogs).not.toContain('data setter in MainBase')

  // nested side effect should not be called (because "importsNotUsedAsValues" is not set, defaults to "remove")
  expect(browserLogs).not.toContain('nested side effect')
  // nested base setter should be called (because of `"useDefineForClassFields": false"`)
  expect(browserLogs).toContain('data setter in NestedBase')

  // nested-with-extends side effect should be called (because "importsNotUsedAsValues" is extended from the main tsconfig.json, which is "preserve")
  expect(browserLogs).toContain('nested-with-extends side effect')
  // nested-with-extends base setter should be called (because of `"useDefineForClassFields": false"`)
  expect(browserLogs).toContain('data setter in NestedWithExtendsBase')
})
