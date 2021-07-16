import { Plugin } from 'vite'

export interface Options {
  /**
   * default: 'defaults'
   */
  targets?: string | string[] | { [key: string]: string }
  /**
   * default: false
   */
  ignoreBrowserslistConfig?: boolean
  /**
   * default: true
   */
  polyfills?: boolean | string[]
  additionalLegacyPolyfills?: string[]
  /**
   * default: false
   */
  modernPolyfills?: boolean | string[]
  /**
   * default: true
   */
  renderLegacyChunks?: boolean
  /**
   * default: http
   */
  protocol?: 'file' | 'http'
}

declare function createPlugin(options?: Options): Plugin

export default createPlugin

export const cspHashes: string[]
