import { add } from './add'

export function multiply(a, b) {
  return a * b
}

export function multiplyAndAdd(a, b, c) {
  return add(multiply(a, b), c)
}
