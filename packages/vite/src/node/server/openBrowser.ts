/**
 * The following is modified based on source found in
 * https://github.com/facebook/create-react-app
 *
 * MIT Licensed
 * Copyright (c) 2015-present, Facebook, Inc.
 * https://github.com/facebook/create-react-app/blob/master/LICENSE
 *
 */

import path from 'path'
import open from 'open'
import execa from 'execa'
import chalk from 'chalk'
import { execSync } from 'child_process'
import { Logger } from '../logger'

// https://github.com/sindresorhus/open#app
const OSX_CHROME = 'google chrome'

/**
 * Reads the BROWSER environment variable and decides what to do with it.
 * Returns true if it opened a browser or ran a node.js script, otherwise false.
 */
export function openBrowser(
  url: string,
  opt: string | true,
  logger: Logger
): boolean {
  // The browser executable to open.
  // See https://github.com/sindresorhus/open#app for documentation.
  const browser = typeof opt === 'string' ? opt : process.env.BROWSER || ''
  if (browser.toLowerCase().endsWith('.js')) {
    return executeNodeScript(browser, url, logger)
  } else if (browser.toLowerCase() !== 'none') {
    return startBrowserProcess(browser, url)
  }
  return false
}

function executeNodeScript(scriptPath: string, url: string, logger: Logger) {
  const extraArgs = process.argv.slice(2)
  const child = execa('node', [scriptPath, ...extraArgs, url], {
    stdio: 'inherit'
  })
  child.on('close', (code) => {
    if (code !== 0) {
      logger.error(
        chalk.red(
          `\nThe script specified as BROWSER environment variable failed.\n\n${chalk.cyan(
            scriptPath
          )} exited with code ${code}.`
        ),
        { error: null }
      )
    }
  })
  return true
}

function startBrowserProcess(browser: string | undefined, url: string) {
  // If we're on OS X, the user hasn't specifically
  // requested a different browser, we can try opening
  // Chrome with AppleScript. This lets us reuse an
  // existing tab when possible instead of creating a new one.
  const shouldTryOpenChromeWithAppleScript =
    process.platform === 'darwin' && (browser === '' || browser === OSX_CHROME)

  if (shouldTryOpenChromeWithAppleScript) {
    try {
      // Try our best to reuse existing tab
      // on OS X Google Chrome with AppleScript
      execSync('ps cax | grep "Google Chrome"')
      execSync('osascript openChrome.applescript "' + encodeURI(url) + '"', {
        cwd: path.dirname(require.resolve('vite/bin/openChrome.applescript')),
        stdio: 'ignore'
      })
      return true
    } catch (err) {
      // Ignore errors
    }
  }

  // Another special case: on OS X, check if BROWSER has been set to "open".
  // In this case, instead of passing the string `open` to `open` function (which won't work),
  // just ignore it (thus ensuring the intended behavior, i.e. opening the system browser):
  // https://github.com/facebook/create-react-app/pull/1690#issuecomment-283518768
  if (process.platform === 'darwin' && browser === 'open') {
    browser = undefined
  }

  // Fallback to open
  // (It will always open new tab)
  try {
    const options: open.Options = browser ? { app: { name: browser } } : {}
    open(url, options).catch(() => {}) // Prevent `unhandledRejection` error.
    return true
  } catch (err) {
    return false
  }
}
