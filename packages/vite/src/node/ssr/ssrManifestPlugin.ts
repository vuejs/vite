import { relative } from 'path'
import { normalizePath } from '@rollup/pluginutils'
import { ResolvedConfig } from '..'
import { Plugin } from '../plugin'
import { chunkToEmittedCssFileMap } from '../plugins/css'
import { chunkToEmittedAssetsMap } from '../plugins/asset'

export function ssrManifestPlugin(config: ResolvedConfig): Plugin {
  // module id => preload assets mapping
  const ssrManifest: Record<string, string[]> = {}
  const base = config.base

  return {
    name: 'vite:manifest',
    generateBundle(_options, bundle) {
      const staticImportsMap: Record<string, string[]> = {}
      for (const file in bundle) {
        const chunk = bundle[file]
        if (chunk.type === 'chunk') {
          staticImportsMap[base + file] = chunk.imports
        }
      }
      for (const file in bundle) {
        const chunk = bundle[file]
        if (chunk.type === 'chunk') {
          // links for certain entry chunks are already generated in static HTML
          // in those cases we only need to record info for non-entry chunks
          const cssFiles = chunk.isEntry
            ? null
            : chunkToEmittedCssFileMap.get(chunk)
          const assetFiles = chunkToEmittedAssetsMap.get(chunk)
          for (const id in chunk.modules) {
            const normalizedId = normalizePath(relative(config.root, id))
            const mappedChunks =
              ssrManifest[normalizedId] || (ssrManifest[normalizedId] = [])
            if (!chunk.isEntry) {
              mappedChunks.push(base + chunk.fileName)
            }
            if (cssFiles) {
              cssFiles.forEach((file) => {
                mappedChunks.push(base + file)
              })
            }
            if (assetFiles) {
              assetFiles.forEach((file) => {
                mappedChunks.push(base + file)
              })
            }
            // also hoist static imports from each mapped chunks
            for (const mappedChunk of [...mappedChunks]) {
              for (const file of staticImportsMap[mappedChunk] || []) {
                mappedChunks.push(base + file)
              }
            }
          }
        }
      }

      this.emitFile({
        fileName: 'ssr-manifest.json',
        type: 'asset',
        source: JSON.stringify(ssrManifest, null, 2)
      })
    }
  }
}
