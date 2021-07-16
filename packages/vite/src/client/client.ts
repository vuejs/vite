import {
  ErrorPayload,
  FullReloadPayload,
  HMRPayload,
  PrunePayload,
  Update,
  UpdatePayload
} from 'types/hmrPayload'
import { CustomEventName } from 'types/customEvent'
import { ErrorOverlay, overlayId } from './overlay'
// eslint-disable-next-line node/no-missing-import
import '@vite/env'

// injected by the hmr plugin when served
declare const __ROOT__: string
declare const __BASE__: string
declare const __HMR_PROTOCOL__: string
declare const __HMR_HOSTNAME__: string
declare const __HMR_PORT__: string
declare const __HMR_TIMEOUT__: number
declare const __HMR_ENABLE_OVERLAY__: boolean

console.log('[vite] connecting...')

// use server configuration, then fallback to inference
const socketProtocol =
  __HMR_PROTOCOL__ || (location.protocol === 'https:' ? 'wss' : 'ws')
const socketHost = `${__HMR_HOSTNAME__ || location.hostname}:${__HMR_PORT__}`
const socket = new WebSocket(`${socketProtocol}://${socketHost}`, 'vite-hmr')
const base = __BASE__ || '/'

function warnFailedFetch(err: Error, path: string | string[]) {
  if (!err.message.match('fetch')) {
    console.error(err)
  }
  console.error(
    `[hmr] Failed to reload ${path}. ` +
      `This could be due to syntax errors or importing non-existent ` +
      `modules. (see errors above)`
  )
}

// Listen for messages
socket.addEventListener('message', async ({ data }) => {
  handleMessage(JSON.parse(data))
})

let isFirstUpdate = true

async function handleMessage(payload: HMRPayload) {
  switch (payload.type) {
    case 'connected':
      console.log(`[vite] connected.`)
      // proxy(nginx, docker) hmr ws maybe caused timeout,
      // so send ping package let ws keep alive.
      setInterval(() => socket.send('ping'), __HMR_TIMEOUT__)
      break
    case 'update':
      notifyListeners('vite:beforeUpdate', payload)
      // if this is the first update and there's already an error overlay, it
      // means the page opened with existing server compile error and the whole
      // module script failed to load (since one of the nested imports is 500).
      // in this case a normal update won't work and a full reload is needed.
      if (isFirstUpdate && hasErrorOverlay()) {
        window.location.reload()
        return
      } else {
        clearErrorOverlay()
        isFirstUpdate = false
      }
      payload.updates.forEach((update) => {
        if (update.type === 'js-update') {
          queueUpdate(fetchUpdate(update))
        } else {
          // css-update
          // this is only sent when a css file referenced with <link> is updated
          let { path, timestamp } = update
          path = path.replace(/\?.*/, '')
          // can't use querySelector with `[href*=]` here since the link may be
          // using relative paths so we need to use link.href to grab the full
          // URL for the include check.
          const el = (
            [].slice.call(
              document.querySelectorAll(`link`)
            ) as HTMLLinkElement[]
          ).find((e) => e.href.includes(path))
          if (el) {
            const newPath = `${path}${
              path.includes('?') ? '&' : '?'
            }t=${timestamp}`
            el.href = new URL(newPath, el.href).href
          }
          console.log(`[vite] css hot updated: ${path}`)
        }
      })
      break
    case 'custom': {
      notifyListeners(payload.event as CustomEventName<any>, payload.data)
      break
    }
    case 'full-reload':
      notifyListeners('vite:beforeFullReload', payload)
      if (payload.path && payload.path.endsWith('.html')) {
        // if html file is edited, only reload the page if the browser is
        // currently on that page.
        const pagePath = location.pathname
        const payloadPath = base + payload.path.slice(1)
        if (
          pagePath === payloadPath ||
          (pagePath.endsWith('/') && pagePath + 'index.html' === payloadPath)
        ) {
          location.reload()
        }
        return
      } else {
        location.reload()
      }
      break
    case 'prune':
      notifyListeners('vite:beforePrune', payload)
      // After an HMR update, some modules are no longer imported on the page
      // but they may have left behind side effects that need to be cleaned up
      // (.e.g style injections)
      // TODO Trigger their dispose callbacks.
      payload.paths.forEach((path) => {
        const fn = pruneMap.get(path)
        if (fn) {
          fn(dataMap.get(path))
        }
      })
      break
    case 'error': {
      notifyListeners('vite:error', payload)
      const err = payload.err
      if (enableOverlay) {
        createErrorOverlay(err)
      } else {
        console.error(
          `[vite] Internal Server Error\n${err.message}\n${err.stack}`
        )
      }
      break
    }
    default: {
      const check: never = payload
      return check
    }
  }
}

function notifyListeners(
  event: 'vite:beforeUpdate',
  payload: UpdatePayload
): void
function notifyListeners(event: 'vite:beforePrune', payload: PrunePayload): void
function notifyListeners(
  event: 'vite:beforeFullReload',
  payload: FullReloadPayload
): void
function notifyListeners(event: 'vite:error', payload: ErrorPayload): void
function notifyListeners<T extends string>(
  event: CustomEventName<T>,
  data: any
): void
function notifyListeners(event: string, data: any): void {
  const cbs = customListenersMap.get(event)
  if (cbs) {
    cbs.forEach((cb) => cb(data))
  }
}

const enableOverlay = __HMR_ENABLE_OVERLAY__

function createErrorOverlay(err: ErrorPayload['err']) {
  if (!enableOverlay) return
  clearErrorOverlay()
  document.body.appendChild(new ErrorOverlay(err))
}

function clearErrorOverlay() {
  document
    .querySelectorAll(overlayId)
    .forEach((n) => (n as ErrorOverlay).close())
}

function hasErrorOverlay() {
  return document.querySelectorAll(overlayId).length
}

let pending = false
let queued: Promise<(() => void) | undefined>[] = []

/**
 * buffer multiple hot updates triggered by the same src change
 * so that they are invoked in the same order they were sent.
 * (otherwise the order may be inconsistent because of the http request round trip)
 */
async function queueUpdate(p: Promise<(() => void) | undefined>) {
  queued.push(p)
  if (!pending) {
    pending = true
    await Promise.resolve()
    pending = false
    const loading = [...queued]
    queued = []
    ;(await Promise.all(loading)).forEach((fn) => fn && fn())
  }
}

async function waitForSuccessfulPing(ms = 1000) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await fetch(`${base}__vite_ping`)
      break
    } catch (e) {
      await new Promise((resolve) => setTimeout(resolve, ms))
    }
  }
}

// ping server
socket.addEventListener('close', async ({ wasClean }) => {
  if (wasClean) return
  console.log(`[vite] server connection lost. polling for restart...`)
  await waitForSuccessfulPing()
  location.reload()
})

// https://wicg.github.io/construct-stylesheets
const supportsConstructedSheet = (() => {
  try {
    // new CSSStyleSheet()
    // return true
  } catch (e) {}
  return false
})()

const sheetsMap = new Map()

export function updateStyle(id: string, content: string): void {
  let style = sheetsMap.get(id)
  if (supportsConstructedSheet && !content.includes('@import')) {
    if (style && !(style instanceof CSSStyleSheet)) {
      removeStyle(id)
      style = undefined
    }

    if (!style) {
      style = new CSSStyleSheet()
      style.replaceSync(content)
      // @ts-ignore
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, style]
    } else {
      style.replaceSync(content)
    }
  } else {
    if (style && !(style instanceof HTMLStyleElement)) {
      removeStyle(id)
      style = undefined
    }

    if (!style) {
      style = document.createElement('style')
      style.setAttribute('type', 'text/css')
      style.innerHTML = content
      document.head.appendChild(style)
    } else {
      style.innerHTML = content
    }
  }
  sheetsMap.set(id, style)
}

export function removeStyle(id: string): void {
  const style = sheetsMap.get(id)
  if (style) {
    if (style instanceof CSSStyleSheet) {
      // @ts-ignore
      const index = document.adoptedStyleSheets.indexOf(style)
      // @ts-ignore
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
        (s: CSSStyleSheet) => s !== style
      )
    } else {
      document.head.removeChild(style)
    }
    sheetsMap.delete(id)
  }
}

async function fetchUpdate({ path, acceptedPath, timestamp }: Update) {
  const mod = hotModulesMap.get(path)
  if (!mod) {
    // In a code-splitting project,
    // it is common that the hot-updating module is not loaded yet.
    // https://github.com/vitejs/vite/issues/721
    return
  }

  const moduleMap = new Map()
  const isSelfUpdate = path === acceptedPath

  // make sure we only import each dep once
  const modulesToUpdate = new Set<string>()
  if (isSelfUpdate) {
    // self update - only update self
    modulesToUpdate.add(path)
  } else {
    // dep update
    for (const { deps } of mod.callbacks) {
      deps.forEach((dep) => {
        if (acceptedPath === dep) {
          modulesToUpdate.add(dep)
        }
      })
    }
  }

  // determine the qualified callbacks before we re-import the modules
  const qualifiedCallbacks = mod.callbacks.filter(({ deps }) => {
    return deps.some((dep) => modulesToUpdate.has(dep))
  })

  await Promise.all(
    Array.from(modulesToUpdate).map(async (dep) => {
      const disposer = disposeMap.get(dep)
      if (disposer) await disposer(dataMap.get(dep))
      const [path, query] = dep.split(`?`)
      try {
        const newMod = await import(
          /* @vite-ignore */
          base +
            path.slice(1) +
            `?import&t=${timestamp}${query ? `&${query}` : ''}`
        )
        moduleMap.set(dep, newMod)
      } catch (e) {
        warnFailedFetch(e, dep)
      }
    })
  )

  return () => {
    for (const { deps, fn } of qualifiedCallbacks) {
      fn(deps.map((dep) => moduleMap.get(dep)))
    }
    const loggedPath = isSelfUpdate ? path : `${acceptedPath} via ${path}`
    console.log(`[vite] hot updated: ${loggedPath}`)
  }
}

interface HotModule {
  id: string
  callbacks: HotCallback[]
}

interface HotCallback {
  // the dependencies must be fetchable paths
  deps: string[]
  fn: (modules: object[]) => void
}

const hotModulesMap = new Map<string, HotModule>()
const disposeMap = new Map<string, (data: any) => void | Promise<void>>()
const pruneMap = new Map<string, (data: any) => void | Promise<void>>()
const dataMap = new Map<string, any>()
const customListenersMap = new Map<string, ((data: any) => void)[]>()
const ctxToListenersMap = new Map<
  string,
  Map<string, ((data: any) => void)[]>
>()

// Just infer the return type for now
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export const createHotContext = (ownerPath: string) => {
  if (!dataMap.has(ownerPath)) {
    dataMap.set(ownerPath, {})
  }

  // when a file is hot updated, a new context is created
  // clear its stale callbacks
  const mod = hotModulesMap.get(ownerPath)
  if (mod) {
    mod.callbacks = []
  }

  // clear stale custom event listeners
  const staleListeners = ctxToListenersMap.get(ownerPath)
  if (staleListeners) {
    for (const [event, staleFns] of staleListeners) {
      const listeners = customListenersMap.get(event)
      if (listeners) {
        customListenersMap.set(
          event,
          listeners.filter((l) => !staleFns.includes(l))
        )
      }
    }
  }

  const newListeners = new Map()
  ctxToListenersMap.set(ownerPath, newListeners)

  function acceptDeps(deps: string[], callback: HotCallback['fn'] = () => {}) {
    const mod: HotModule = hotModulesMap.get(ownerPath) || {
      id: ownerPath,
      callbacks: []
    }
    mod.callbacks.push({
      deps,
      fn: callback
    })
    hotModulesMap.set(ownerPath, mod)
  }

  const hot = {
    get data() {
      return dataMap.get(ownerPath)
    },

    accept(deps: any, callback?: any) {
      if (typeof deps === 'function' || !deps) {
        // self-accept: hot.accept(() => {})
        acceptDeps([ownerPath], ([mod]) => deps && deps(mod))
      } else if (typeof deps === 'string') {
        // explicit deps
        acceptDeps([deps], ([mod]) => callback && callback(mod))
      } else if (Array.isArray(deps)) {
        acceptDeps(deps, callback)
      } else {
        throw new Error(`invalid hot.accept() usage.`)
      }
    },

    acceptDeps() {
      throw new Error(
        `hot.acceptDeps() is deprecated. ` +
          `Use hot.accept() with the same signature instead.`
      )
    },

    dispose(cb: (data: any) => void) {
      disposeMap.set(ownerPath, cb)
    },

    prune(cb: (data: any) => void) {
      pruneMap.set(ownerPath, cb)
    },

    // TODO
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    decline() {},

    invalidate() {
      // TODO should tell the server to re-perform hmr propagation
      // from this module as root
      location.reload()
    },

    // custom events
    on: (event: string, cb: (data: any) => void) => {
      const addToMap = (map: Map<string, any[]>) => {
        const existing = map.get(event) || []
        existing.push(cb)
        map.set(event, existing)
      }
      addToMap(customListenersMap)
      addToMap(newListeners)
    }
  }

  return hot
}

/**
 * urls here are dynamic import() urls that couldn't be statically analyzed
 */
export function injectQuery(url: string, queryToInject: string): string {
  // skip urls that won't be handled by vite
  if (!url.startsWith('.') && !url.startsWith('/')) {
    return url
  }

  // can't use pathname from URL since it may be relative like ../
  const pathname = url.replace(/#.*$/, '').replace(/\?.*$/, '')
  const { search, hash } = new URL(url, 'http://vitejs.dev')

  return `${pathname}?${queryToInject}${search ? `&` + search.slice(1) : ''}${
    hash || ''
  }`
}
