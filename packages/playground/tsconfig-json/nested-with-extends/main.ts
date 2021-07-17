// @ts-nocheck
import { NestedWithExtendsTypeOnlyClass } from './not-used-type'

class NestedWithExtendsBase {
  set data(value: string) {
    console.log('data setter in NestedWithExtendsBase')
  }
}
class NestedWithExtendsDerived extends NestedWithExtendsBase {
  // No longer triggers a 'console.log'
  // when using 'useDefineForClassFields'.
  data = 10

  foo?: NestedWithExtendsTypeOnlyClass
}

const d = new NestedWithExtendsDerived()
