import fs from 'fs'
import { dirname } from 'path'
import { join } from 'path'

// https://github.com/vitejs/vite/issues/2820#issuecomment-812495079
const ROOT_FILES = [
  '.git',

  // https://pnpm.js.org/workspaces/
  'pnpm-workspace.yaml'

  // https://rushjs.io/pages/advanced/config_files/
  // 'rush.json',

  // https://nx.dev/latest/react/getting-started/nx-setup
  // 'workspace.json',
  // 'nx.json'
]

// npm: https://docs.npmjs.com/cli/v7/using-npm/workspaces#installing-workspaces
// yarn: https://classic.yarnpkg.com/en/docs/workspaces/#toc-how-to-use-it
function hasWorkspacePackageJSON(root: string): boolean {
  const path = join(root, 'package.json')
  if (!fs.existsSync(path)) return false
  const content = JSON.parse(fs.readFileSync(path, 'utf-8')) || {}
  return !!content.workspaces
}

function hasRootFile(root: string): boolean {
  for (const file of ROOT_FILES) {
    if (fs.existsSync(join(root, file))) return true
  }
  return false
}

export function searchForWorkspaceRoot(
  current: string,
  depth: number,
  root = current
): string {
  if (depth <= 0) return root
  if (hasRootFile(current)) return current
  if (hasWorkspacePackageJSON(current)) return current

  const dir = dirname(current)
  // reach the fs root
  if (dir === current) return root

  return searchForWorkspaceRoot(dir, depth - 1, root)
}