module.exports = {
  server: {
    port: 3000,
    proxy: {
      '/v1': {
        target: 'http://localhost:8081',
        // router: {
        //   'localhost:3000': 'http://localhost:8080'
        // }
        // router: function(req) {
        //   return 'http://localhost:8080'
        // },
        router: function (req) {
          return {
            protocol: 'http:',
            host: 'localhost',
            port: 8080
          }
        }
      }
    }
  }
}
