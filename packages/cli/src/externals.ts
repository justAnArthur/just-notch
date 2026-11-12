/** The modules the runtime's import map provides; plugin builds leave exactly these as bare imports. */
export const SHARED_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  'motion',
  'motion/react',
  '@justanarthur/modo-ui',
  '@just-notch/sdk',
] as const

const SHARED_PACKAGES = new Set(SHARED_MODULES.map(packageName))

function packageName(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!
}

export type ImportRule = { kind: 'external' } | { kind: 'bundle' } | { kind: 'error'; message: string }

/** How a plugin build treats a bare import specifier. */
export function classifyImport(specifier: string): ImportRule {
  if ((SHARED_MODULES as readonly string[]).includes(specifier)) return { kind: 'external' }

  const pkg = packageName(specifier)
  if (!SHARED_PACKAGES.has(pkg)) return { kind: 'bundle' }

  if (pkg === '@justanarthur/modo-ui')
    return {
      kind: 'error',
      message: `"${specifier}": import modo-ui from the barrel "@justanarthur/modo-ui"; its subpaths are not shared with plugins`,
    }

  return {
    kind: 'error',
    message: `"${specifier}" is not in the runtime's import map (shared: ${SHARED_MODULES.join(', ')}); bundling it would load a second copy of "${pkg}"`,
  }
}
