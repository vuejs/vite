document.querySelector('.clickme').addEventListener('click', async () => {
  const { test } = await import('./dep.js')
  document.querySelector('.content').textContent = test()
})
