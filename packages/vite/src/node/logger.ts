/* eslint no-console: 0 */

import chalk from 'chalk'
import readline from 'readline'
import os from 'os'
import { Hostname } from './utils'

export type LogType = 'error' | 'warn' | 'info'
export type LogLevel = LogType | 'silent'
export interface Logger {
  info(msg: string, options?: LogOptions): void
  warn(msg: string, options?: LogOptions): void
  warnOnce(msg: string, options?: LogOptions): void
  error(msg: string, options?: LogOptions): void
  clearScreen(type: LogType): void
  hasWarned: boolean
}

export interface LogOptions {
  clear?: boolean
  timestamp?: boolean
}

export const LogLevels: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3
}

let lastType: LogType | undefined
let lastMsg: string | undefined
let sameCount = 0

function clearScreen() {
  const repeatCount = process.stdout.rows - 2
  const blank = repeatCount > 0 ? '\n'.repeat(repeatCount) : ''
  console.log(blank)
  readline.cursorTo(process.stdout, 0, 0)
  readline.clearScreenDown(process.stdout)
}

export interface LoggerOptions {
  prefix?: string
  allowClearScreen?: boolean
  logger?: Logger
}

export function createLogger(
  level: LogLevel = 'info',
  options: LoggerOptions = {}
): Logger {
  if (options.logger) {
    return options.logger
  }
  
  const { prefix = '[vite]', allowClearScreen = true } = options
  const thresh = LogLevels[level]
  const clear =
    allowClearScreen && process.stdout.isTTY && !process.env.CI
      ? clearScreen
      : () => {}

  function output(type: LogType, msg: string, options: LogOptions = {}) {
    if (thresh >= LogLevels[type]) {
      const method = type === 'info' ? 'log' : type
      const format = () => {
        if (options.timestamp) {
          const tag =
            type === 'info'
              ? chalk.cyan.bold(prefix)
              : type === 'warn'
              ? chalk.yellow.bold(prefix)
              : chalk.red.bold(prefix)
          return `${chalk.dim(new Date().toLocaleTimeString())} ${tag} ${msg}`
        } else {
          return msg
        }
      }
      if (type === lastType && msg === lastMsg) {
        sameCount++
        clear()
        console[method](format(), chalk.yellow(`(x${sameCount + 1})`))
      } else {
        sameCount = 0
        lastMsg = msg
        lastType = type
        if (options.clear) {
          clear()
        }
        console[method](format())
      }
    }
  }

  const warnedMessages = new Set<string>()

  const logger: Logger = {
    hasWarned: false,
    info(msg, opts) {
      output('info', msg, opts)
    },
    warn(msg, opts) {
      logger.hasWarned = true
      output('warn', msg, opts)
    },
    warnOnce(msg, opts) {
      if (warnedMessages.has(msg)) return
      logger.hasWarned = true
      output('warn', msg, opts)
      warnedMessages.add(msg)
    },
    error(msg, opts) {
      logger.hasWarned = true
      output('error', msg, opts)
    },
    clearScreen(type) {
      if (thresh >= LogLevels[type]) {
        clear()
      }
    }
  }

  return logger
}

export function printServerUrls(
  hostname: Hostname,
  protocol: string,
  port: number,
  base: string,
  info: Logger['info']
): void {
  if (hostname.host === '127.0.0.1') {
    const url = `${protocol}://${hostname.name}:${chalk.bold(port)}${base}`
    info(`  > Local: ${chalk.cyan(url)}`)
    if (hostname.name !== '127.0.0.1') {
      info(`  > Network: ${chalk.dim('use `--host` to expose')}`)
    }
  } else {
    Object.values(os.networkInterfaces())
      .flatMap((nInterface) => nInterface ?? [])
      .filter((detail) => detail.family === 'IPv4')
      .map((detail) => {
        const type = detail.address.includes('127.0.0.1')
          ? 'Local:   '
          : 'Network: '
        const host = detail.address.replace('127.0.0.1', hostname.name)
        const url = `${protocol}://${host}:${chalk.bold(port)}${base}`
        return `  > ${type} ${chalk.cyan(url)}`
      })
      .forEach((msg) => info(msg))
  }
}
