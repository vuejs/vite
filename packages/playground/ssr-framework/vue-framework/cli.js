const { startServer } = require('./server')
const { build } = require('./build')

cli()

async function cli() {
  const root = process.cwd()
  const port = 3000
  const cliCommand = process.argv[2]
  if (cliCommand === undefined) {
    await startServer(root, port, false)
    console.log(`http://localhost:${port}`)
    return
  }
  if (cliCommand === 'build') {
    build(root)
    return
  }
  if (cliCommand === 'serve') {
    process.env.NODE_ENV = 'production'
    await startServer(root, port, true)
    console.log(`http://localhost:${port}`)
    return
  }
  throw new Error(`Unknown command ${cliCommand}`)
}
