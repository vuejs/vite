import { valueA } from './circular-dep-init'

export const valueB = 'circ-dep-init-b'
export const valueAB = valueA.concat(` ${valueB}`)

export function getValueAB() {
  return valueAB
}
