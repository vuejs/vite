import { stuckModuleExport } from './stuck-module'
import { deadlockfuseModuleExport } from './deadlock-fuse-module'

/**
 * module H
 */
export function commonModuleExport() {
  stuckModuleExport()
  deadlockfuseModuleExport()
}
