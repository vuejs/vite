// @ts-nocheck
import '../nested/main'
import '../nested-with-extends/main'

import { MainTypeOnlyClass } from './not-used-type'

class MainBase {
  set data(value: string) {
    console.log('data setter in MainBase')
  }
}
class MainDerived extends MainBase {
  // No longer triggers a 'console.log'
  // when using 'useDefineForClassFields'.
  data = 10

  foo?: MainTypeOnlyClass
}

const d = new MainDerived()
