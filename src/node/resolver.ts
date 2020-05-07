import path from 'path'
import slash from 'slash'
import { statSync } from 'fs'
import { cleanUrl } from './utils'

export interface Resolver {
  requestToFile(publicPath: string, root: string): string | undefined
  fileToRequest(filePath: string, root: string): string | undefined
  idToRequest?(id: string): string | undefined
}

export interface InternalResolver {
  requestToFile(publicPath: string): string
  fileToRequest(filePath: string): string
  idToRequest(id: string): string | undefined
}

const defaultRequestToFile = (publicPath: string, root: string) =>
  path.join(root, publicPath.slice(1))

const defaultFileToRequest = (filePath: string, root: string) =>
  `/${slash(path.relative(root, filePath))}`

const defaultIdToRequest = (id: string) => {
  // If requires `@vue/runtime-*` default to the runtime vue
  if (id.startsWith('@vue/runtime-')) {
    return '/@modules/vue'
  }
  if (id.startsWith('@') && id.indexOf('/') < 0) {
    return `/${id}`
  }
}

export const supportedExts = ['.js', '.jsx', '.ts', '.tsx', '.json']

export const ensureExt = (id: string) => {
  const cleanId = cleanUrl(id)
  if (!/\.\w+$/.test(cleanId)) {
    let inferredExt = ''
    for (const ext of supportedExts) {
      try {
        statSync(id + ext)
        inferredExt = ext
        break
      } catch (e) {}
    }
    const queryMatch = id.match(/\?.*$/)
    const query = queryMatch ? queryMatch[0] : ''
    return cleanId + inferredExt + query
  }
  return id
}

export function createResolver(
  root: string,
  resolvers: Resolver[]
): InternalResolver {
  return {
    requestToFile: (publicPath) => {
      let resolved: string | undefined
      for (const r of resolvers) {
        const filepath = r.requestToFile(publicPath, root)
        if (filepath) {
          resolved = filepath
          break
        }
      }
      if (!resolved) {
        resolved = defaultRequestToFile(publicPath, root)
      }
      resolved = ensureExt(resolved)
      return resolved
    },
    fileToRequest: (filePath) => {
      for (const r of resolvers) {
        const request = r.fileToRequest(filePath, root)
        if (request) return request
      }
      return defaultFileToRequest(filePath, root)
    },
    idToRequest: (id: string) => {
      for (const r of resolvers) {
        const request = r.idToRequest && r.idToRequest(id)
        if (request) return request
      }
      return defaultIdToRequest(id)
    }
  }
}
