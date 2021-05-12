const modules = import.meta.globEager('./*.js', './_*.js')

export { modules }
