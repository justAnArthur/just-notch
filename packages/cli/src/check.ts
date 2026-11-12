import { dirname, join } from 'node:path'
import { loadPlugin } from './plugin'

function tscPath(root: string): string {
  try {
    return Bun.resolveSync('typescript/bin/tsc', root)
  } catch {
    return Bun.resolveSync('typescript/bin/tsc', dirname(import.meta.dir))
  }
}

/** Manifest validation, then `tsc --noEmit` in the plugin. Returns tsc's exit code. */
export async function checkPlugin(root: string): Promise<{ warnings: string[]; exitCode: number }> {
  const { warnings } = await loadPlugin(root)
  const tsc = Bun.spawn([process.execPath, tscPath(root), '--noEmit', '-p', join(root, 'tsconfig.json')], {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  return { warnings, exitCode: await tsc.exited }
}
