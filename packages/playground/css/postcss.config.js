module.exports = (api) => {
  if (/\.sss$/.test(api.file)) {
    return {
      parser: 'sugarss',
      plugins: [require('postcss-simple-vars'), require('postcss-nested')]
    }
  }

  return {
    plugins: [require('postcss-nested')]
  }
}
