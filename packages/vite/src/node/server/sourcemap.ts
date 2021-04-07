import { promises as fs } from 'fs'
import path from 'path'

export async function injectSourcesContent(
  map: { sources: string[]; sourcesContent?: string[]; sourceRoot?: string },
  file: string
) {
  try {
    var sourceRoot = await fs.realpath(
      path.resolve(path.dirname(file), map.sourceRoot || '')
    )
  } catch (e) {
    if (e.code == 'ENOENT') return
    throw e
  }
  map.sourcesContent = []
  await Promise.all(
    map.sources.map(async (sourcePath, i) => {
      try {
        map.sourcesContent![i] = await fs.readFile(
          path.resolve(sourceRoot, decodeURI(sourcePath)),
          'utf-8'
        )
      } catch (e) {
        if (e.code == 'ENOENT') return
        throw e
      }
    })
  )
}
