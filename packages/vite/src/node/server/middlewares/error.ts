import chalk from 'chalk'
import { RollupError } from 'rollup'
import { ViteDevServer } from '../..'
import { Connect } from 'types/connect'
import { pad } from '../../utils'
import strip from 'strip-ansi'
import { ErrorPayload } from 'types/hmrPayload'

export function prepareError(err: Error | RollupError): ErrorPayload['err'] {
  // only copy the information we need and avoid serializing unnecessary
  // properties, since some errors may attach full objects (e.g. PostCSS)
  return {
    message: strip(err.message),
    stack: strip(cleanStack(err.stack || '')),
    id: (err as RollupError).id,
    frame: strip((err as RollupError).frame || ''),
    plugin: (err as RollupError).plugin,
    pluginCode: (err as RollupError).pluginCode,
    loc: (err as RollupError).loc
  }
}

export function buildErrorMessage(
  err: RollupError,
  args: string[] = [],
  includeStack = true
): string {
  if (err.plugin) args.push(`  Plugin: ${chalk.magenta(err.plugin)}`)
  if (err.id) args.push(`  File: ${chalk.cyan(err.id)}`)
  if (err.frame) args.push(chalk.yellow(pad(err.frame)))
  if (includeStack && err.stack) args.push(pad(cleanStack(err.stack)))
  return args.join('\n')
}

function cleanStack(stack: string) {
  return stack
    .split(/\n/g)
    .filter((l) => /^\s*at/.test(l))
    .join('\n')
}

export function errorMiddleware(
  server: ViteDevServer,
  allowNext = false
): Connect.ErrorHandleFunction {
  // note the 4 args must be kept for connect to treat this as error middleware
  // Keep the named function. The name is visible in debug logs via `DEBUG=connect:dispatcher ...`
  return function viteErrorMiddleware(err: RollupError, _req, res, next) {
    const msg = buildErrorMessage(err, [
      chalk.red(`Internal server error: ${err.message}`)
    ])

    server.config.logger.error(msg, {
      clear: true,
      timestamp: true,
      error: err
    })

    server.ws.send({
      type: 'error',
      err: prepareError(err)
    })

    if (allowNext) {
      next()
    } else {
      if (err instanceof AccessRestrictedError) {
        res.statusCode = 403
        res.write(renderErrorHTML(err.message))
        res.end()
      }
      res.statusCode = 500
      res.end()
    }
  }
}

export class AccessRestrictedError extends Error {
  constructor(msg: string) {
    super(msg)
  }
}

export function renderErrorHTML(msg: string): string {
  // to have syntax highlighting and autocompletion in IDE
  const html = String.raw
  return html`
    <body>
      <h1>403 Restricted</h1>
      <p>${msg.replace(/\n/g, '<br/>')}</p>
      <style>
        body {
          padding: 1em 2em;
        }
      </style>
    </body>
  `
}
