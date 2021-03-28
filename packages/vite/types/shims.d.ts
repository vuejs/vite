declare module 'connect' {
  const connect: () => any
  export = connect
}

declare module 'cors' {
  function cors(options: any): any
  export = cors
}

declare module 'selfsigned' {
  export function generate(attrs: any, options: any, done?: any): any
}

declare module 'http-proxy' {
  const proxy: any
  export = proxy
}

declare module 'acorn-class-fields' {
  const plugin: any
  export = plugin
}

declare module 'acorn-static-class-features' {
  const plugin: any
  export default plugin
}

declare module 'acorn-numeric-separator' {
  const plugin: any
  export default plugin
}

declare module 'connect-history-api-fallback' {
  const plugin: any
  export = plugin
}

declare module 'launch-editor-middleware' {
  const plugin: any
  export = plugin
}

declare module 'merge-source-map' {
  export default function merge(oldMap: object, newMap: object): object
}

declare module 'postcss-import' {
  import { Plugin } from 'postcss'
  const plugin: (options: {
    resolve: (
      id: string,
      basedir: string,
      importOptions: any
    ) => string | string[] | Promise<string | string[]>
  }) => Plugin
  export = plugin
}

declare module 'postcss-modules' {
  import { Plugin } from 'postcss'
  const plugin: (options: any) => Plugin
  export = plugin
}

declare module '@rollup/plugin-dynamic-import-vars' {
  import { Plugin } from 'rollup'

  interface Options {
    include?: string | RegExp | (string | RegExp)[]
    exclude?: string | RegExp | (string | RegExp)[]
    warnOnError?: boolean
  }

  const p: (o?: Options) => Plugin
  export default p
}

declare module 'rollup-plugin-web-worker-loader' {
  import { Plugin } from 'rollup'

  interface Options {
    targetPlatform?: string
    pattern?: RegExp
    extensions?: string[]
    sourcemap?: boolean
    inline?: boolean
  }

  const p: (o?: Options) => Plugin
  export default p
}

declare module 'minimatch' {
  function match(path: string, pattern: string): boolean
  export default match
}

declare module 'compression' {
  function compression(): any
  export default compression
}

// LESS' types somewhat references this which doesn't make sense in Node,
// so we have to shim it
declare interface HTMLLinkElement {}
