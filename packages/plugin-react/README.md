# @vitejs/plugin-react [![npm](https://img.shields.io/npm/v/@vitejs/plugin-react.svg)](https://npmjs.com/package/@vitejs/plugin-react)

The all-in-one Vite plugin for React projects.

- enable [Fast Refresh](https://www.npmjs.com/package/react-refresh) in development
- use the [automatic JSX runtime](https://github.com/alloc/vite-react-jsx#faq)
- avoid manual `import React` in `.jsx` and `.tsx` modules
- use custom Babel plugins/presets

```js
// vite.config.js
import reactPlugin from '@vitejs/plugin-react'

export default {
  plugins: [reactPlugin()]
}
```

## Filter which files use Fast Refresh

By default, Fast Refresh is used by files ending with `.js`, `.jsx`, `.ts`, and `.tsx`, except for files with a `node_modules` parent directory.

In some situations, you may not want a file to act as a HMR boundary, instead preferring that the changes propagate higher in the stack before being handled. In these cases, you can provide an `include` and/or `exclude` option, which can be a regex, a [picomatch](https://github.com/micromatch/picomatch#globbing-features) pattern, or an array of either. Files matching `include` and not `exclude` will use Fast Refresh. The defaults are always applied.

```js
reactPlugin({
  // Exclude storybook stories
  exclude: /\.stories\.(t|j)sx?$/,
  // Only .tsx files
  include: '**/*.tsx'
})
```

## Babel configuration

The `babel` option lets you add plugins, presets, and [other configuration](https://babeljs.io/docs/en/options) to the Babel transformation performed on each JSX/TSX file.

```js
reactPlugin({
  babel: {
    presets: [...],
    // Your plugins run before any built-in transform (eg: Fast Refresh)
    plugins: [...],
    // Use .babelrc files
    babelrc: true,
    // Use babel.config.js files
    configFile: true,
  }
})
```

### Proposed syntax

If you are using ES syntax that are still in proposal status (e.g. class properties), you can selectively enable them with the `babel.parserOpts.plugins` option:

```js
reactPlugin({
  babel: {
    parserOpts: {
      plugins: ['decorators-legacy']
    }
  }
})
```

This option does not enable _code transformation_. That is handled by ESBuild.

**Note:** TypeScript syntax is handled automatically.

Here's the [complete list of Babel parser plugins](https://babeljs.io/docs/en/babel-parser#ecmascript-proposalshttpsgithubcombabelproposals).

## Middleware mode

In [middleware mode](https://vitejs.dev/config/#server-middlewaremode), you should make sure your entry `index.html` file is transformed by Vite. Here's an example for an Express server:

```js
app.get('/', async (req, res, next) => {
  try {
    let html = fs.readFileSync(path.resolve(root, 'index.html'), 'utf-8')

    // Transform HTML using Vite plugins.
    html = await viteServer.transformIndexHtml(req.url, html)

    res.send(html)
  } catch (e) {
    return next(e)
  }
})
```

Otherwise, you'll probably get this error:

```
Uncaught Error: @vitejs/plugin-react can't detect preamble. Something is wrong.
```
