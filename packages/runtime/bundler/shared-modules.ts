/**
 * The modules the runtime shares with every plugin through the import map: one
 * instance of each for the whole page. Plugin builds mark exactly these
 * specifiers external; the runtime build emits them to `dist/shared/<file>`.
 */
export const SHARED_MODULES = {
  react: 'react.js',
  'react/jsx-runtime': 'react-jsx-runtime.js',
  'react-dom': 'react-dom.js',
  'react-dom/client': 'react-dom-client.js',
  motion: 'motion.js',
  'motion/react': 'motion-react.js',
  '@justanarthur/modo-ui': 'modo-ui.js',
  '@justanarthur/modo-ui-notch': 'modo-ui-notch.js',
  '@just-notch/sdk': 'sdk.js',
} as const

/** Dev only: the automatic JSX runtime of unminified builds. Plugins never need it. */
export const DEV_SHARED_MODULES = {
  ...SHARED_MODULES,
  'react/jsx-dev-runtime': 'react-jsx-dev-runtime.js',
} as const

export type SharedSpecifier = keyof typeof DEV_SHARED_MODULES

export const SHARED_BASE = '/shared/'

export function importMap(modules: Record<string, string>) {
  return { imports: Object.fromEntries(Object.entries(modules).map(([spec, file]) => [spec, SHARED_BASE + file])) }
}
