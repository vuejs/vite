const express = require('express')

async function createHostServer(root, isProd) {
  const app = express()

  app.use('*', async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ key: 'router' }))
  })

  return app
}

exports.createHostServer = createHostServer
