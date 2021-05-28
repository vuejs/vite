import { Plugin } from 'vite'
import { ParserOptions } from '@babel/core'

type PluginFactory = (options?: Options) => Plugin

declare const createPlugin: PluginFactory & { preambleCode: string }

export interface Options {
  parserPlugins?: ParserOptions['plugins']
  include?: string | RegExp | Array<string | RegExp>
  exclude?: string | RegExp | Array<string | RegExp>
}

export default createPlugin
