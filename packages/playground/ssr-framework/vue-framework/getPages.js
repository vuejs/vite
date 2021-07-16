export { getPages }

async function getPages() {
  const pages = import.meta.glob('/**/pages/*.vue')
  return pages
}
