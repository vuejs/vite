import babelRestoreJSX from './babel-restore-jsx'
import * as babel from '@babel/core'

function jsx(code: string) {
  return babel.transform(code, {
    parserOpts: { plugins: ['jsx'] },
    plugins: [babelRestoreJSX]
  })?.code
}

// Tests adapted from: https://github.com/flying-sheep/babel-plugin-transform-react-createelement-to-jsx/blob/63137b6/test/index.js
describe('babel-restore-jsx', () => {
  it('should convert 1-argument calls', () => {
    expect(jsx('React.createElement("h1")')).toMatchInlineSnapshot(`"<h1 />;"`)
    expect(jsx('React.createElement(Foo)')).toMatchInlineSnapshot(`"<Foo />;"`)
    expect(jsx('React.createElement(Foo.Bar)')).toMatchInlineSnapshot(
      `"<Foo.Bar />;"`
    )
    expect(jsx('React.createElement(Foo.Bar.Baz)')).toMatchInlineSnapshot(
      `"<Foo.Bar.Baz />;"`
    )
  })

  it('should convert effective 1-argument calls (with null or undefined)', () => {
    expect(jsx('React.createElement("h1", null)')).toMatchInlineSnapshot(
      `"<h1 />;"`
    )
    expect(jsx('React.createElement("h2", null, null)')).toMatchInlineSnapshot(
      `"<h2 />;"`
    )
    expect(jsx('React.createElement("h3", undefined)')).toMatchInlineSnapshot(
      `"<h3 />;"`
    )
  })

  it('should handle props without children', () => {
    expect(jsx('React.createElement("h1", {hi: there})')).toMatchInlineSnapshot(
      `"<h1 hi={there} />;"`
    )
    expect(
      jsx('React.createElement("h2", {"hi": there})')
    ).toMatchInlineSnapshot(`"<h2 hi={there} />;"`)
    expect(
      jsx('React.createElement("h3", {hi: "there"})')
    ).toMatchInlineSnapshot(`"<h3 hi=\\"there\\" />;"`)
  })

  it('should handle spread props', () => {
    expect(jsx('React.createElement("h1", props)')).toMatchInlineSnapshot(
      `"<h1 {...props} />;"`
    )
    expect(jsx('React.createElement("h1", getProps())')).toMatchInlineSnapshot(
      `"<h1 {...getProps()} />;"`
    )
  })

  it('should handle mixed props', () => {
    expect(
      jsx('React.createElement("h1", _extends({ hi: "there" }, props))')
    ).toMatchInlineSnapshot(`"<h1 hi=\\"there\\" {...props} />;"`)
    expect(
      jsx('React.createElement("h1", _extends({}, props, { hi: "there" }))')
    ).toMatchInlineSnapshot(`"<h1 {...props} hi=\\"there\\" />;"`)
    expect(
      jsx('React.createElement("h1", { ...props, hi: "there" })')
    ).toMatchInlineSnapshot(`"<h1 {...props} hi=\\"there\\" />;"`)
  })

  it('should handle props and ignore “null”/“undefined” children', () => {
    expect(
      jsx('React.createElement("h1", {hi: there}, null, undefined)')
    ).toMatchInlineSnapshot(`"<h1 hi={there} />;"`)
  })

  it('should ignore “null”/“undefined” props and handle children', () => {
    expect(
      jsx('React.createElement("h1", null, "Header")')
    ).toMatchInlineSnapshot(`"<h1>Header</h1>;"`)
    //this can be created from e.g. '<h2>Header{"harhar"}</h2>', but i think there’s no downside to merging it
    expect(
      jsx('React.createElement("h2", null, "Header", "harhar")')
    ).toMatchInlineSnapshot(`"<h2>Headerharhar</h2>;"`)
    expect(
      jsx('React.createElement("h3", null, React.createElement("i"))')
    ).toMatchInlineSnapshot(`"<h3><i /></h3>;"`)
    expect(
      jsx('React.createElement("h4", null, "a", React.createElement("b"), "c")')
    ).toMatchInlineSnapshot(`"<h4>a<b />c</h4>;"`)
  })

  it('should handle props and children', () => {
    //we extensively tested props and children separately, so only sth. basic
    expect(
      jsx('React.createElement("h1", {hi: there}, "Header")')
    ).toMatchInlineSnapshot(`"<h1 hi={there}>Header</h1>;"`)
  })

  it('should ignore intermingled “null”/“undefined” children', () => {
    expect(
      jsx('React.createElement("h1", null, null, "Header", undefined)')
    ).toMatchInlineSnapshot(`"<h1>Header</h1>;"`)
  })

  it('should handle children in nested expressions', () => {
    expect(
      jsx(
        'React.createElement("h1", null, foo ? React.createElement("p") : null)'
      )
    ).toMatchInlineSnapshot(`"<h1>{foo ? <p /> : null}</h1>;"`)
  })
})
