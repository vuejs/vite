import { promises as fs } from 'fs'
import path from 'path'
import { ModuleGraph } from './moduleGraph'

export async function injectSourcesContent(
  map: { sources: string[]; sourcesContent?: string[]; sourceRoot?: string },
  file: string,
  moduleGraph?: ModuleGraph
): Promise<void> {
  const sourceRoot = await fs.realpath(
    path.resolve(path.dirname(file), map.sourceRoot || '')
  )
  const needsContent = !map.sourcesContent
  if (needsContent) {
    map.sourcesContent = []
  }
  await Promise.all(
    map.sources.filter(Boolean).map(async (sourcePath, i) => {
      const mod = await moduleGraph?.getModuleByUrl(sourcePath)
      sourcePath = mod?.file || path.resolve(sourceRoot, decodeURI(sourcePath))
      if (moduleGraph) {
        map.sources[i] = sourcePath
      }
      if (needsContent) {
        map.sourcesContent![i] = await fs.readFile(sourcePath, 'utf-8')
      }
    })
  )
}
