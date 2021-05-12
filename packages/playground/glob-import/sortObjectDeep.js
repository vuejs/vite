export default function sortObjectDeep(target) {
  if (!target || typeof target !== 'object') return target
  return Object.keys(target)
    .sort()
    .reduce(
      (acc, item) => ({
        ...acc,
        [item]:
          typeof target[item] === 'object'
            ? sortObjectDeep(target[item])
            : target[item]
      }),
      {}
    )
}
