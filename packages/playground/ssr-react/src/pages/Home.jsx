import { addAndMultiply } from '../add'
import { multiplyAndAdd } from '../multiply'
import { commonModuleExport } from '../forked-deadlock/common-module'
import { getValueAB } from '../circular-dep-init/circular-dep-init'

export default function Home() {
  commonModuleExport()

  return (
    <>
      <h1>Home</h1>
      <div>{addAndMultiply(1, 2, 3)}</div>
      <div>{multiplyAndAdd(1, 2, 3)}</div>
      <div className="circ-dep-init">{getValueAB()}</div>
    </>
  )
}
