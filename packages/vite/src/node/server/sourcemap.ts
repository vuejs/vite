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
    if (e.code !== 'ENOENT') throw e
    var isVirtual = true
  }
  map.sourcesContent = []
  await Promise.all(
    map.sources.map(async (sourcePath, i) => {
      sourcePath = decodeURI(sourcePath)
      if (!isVirtual) {
        sourcePath = path.resolve(sourceRoot, sourcePath)
      }
      map.sourcesContent![i] = await fs.readFile(sourcePath, 'utf-8')
    })
  )
}
