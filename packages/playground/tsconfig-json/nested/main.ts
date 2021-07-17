// @ts-nocheck
import { NestedTypeOnlyClass } from './not-used-type'

class NestedBase {
  set data(value: string) {
    console.log('data setter in NestedBase')
  }
}
class NestedDerived extends NestedBase {
  // No longer triggers a 'console.log'
  // when using 'useDefineForClassFields'.
  data = 10

  foo?: NestedTypeOnlyClass
}

const d = new NestedDerived()
