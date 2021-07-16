import { deadlockfuseModuleExport } from './deadlock-fuse-module'

/**
 * module Y
 */
export function middleModuleExport() {
  void deadlockfuseModuleExport
}
