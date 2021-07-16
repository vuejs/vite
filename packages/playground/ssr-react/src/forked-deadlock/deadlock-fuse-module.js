import { fuseStuckBridgeModuleExport } from './fuse-stuck-bridge-module'

/**
 * module A
 */
export function deadlockfuseModuleExport() {
  fuseStuckBridgeModuleExport()
}
