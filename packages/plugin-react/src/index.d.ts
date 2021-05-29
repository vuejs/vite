import { Plugin } from 'vite'
import { TransformOptions, ParserOptions } from '@babel/core'

export interface Options {
  include?: string | RegExp | Array<string | RegExp>
  exclude?: string | RegExp | Array<string | RegExp>
  /**
   * Enable `react-refresh` integration. Vite disables this in prod env or build mode.
   * @default true
   */
  fastRefresh?: boolean
  /**
   * Set this to `"automatic"` to use [vite-react-jsx](https://github.com/alloc/vite-react-jsx).
   * @default "classic"
   */
  jsxRuntime?: 'classic' | 'automatic'
  /**
   * Babel configuration applied in both dev and prod.
   */
  babel?: TransformOptions
  /**
   * @deprecated Use `babel.parserOpts.plugins` instead
   */
  parserPlugins?: ParserOptions['plugins']
}

declare const viteReact: (options?: Options) => Plugin

export default viteReact

export const preambleCode: string
