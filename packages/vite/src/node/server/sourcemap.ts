import { promises as fs } from 'fs'
import path from 'path'
import { SourceMap } from 'rollup'

export async function injectSourcesContent(
  map: { sources: string[]; sourcesContent?: string[]; sourceRoot?: string },
  file: string
): Promise<void> {
  const sourceRoot = await fs.realpath(
    path.resolve(path.dirname(file), map.sourceRoot || '')
  )
  map.sourcesContent = []
  await Promise.all(
    map.sources.filter(Boolean).map(async (sourcePath, i) => {
      map.sourcesContent![i] = await fs.readFile(
        path.resolve(sourceRoot, decodeURI(sourcePath)),
        'utf-8'
      )
    })
  )
}

export function genSourceMapString(
  map: SourceMap | string | undefined
): string {
  if (typeof map !== 'string') {
    map = JSON.stringify(map)
  }
  return `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(
    map
  ).toString('base64')}`
}
