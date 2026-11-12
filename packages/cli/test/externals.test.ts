import { describe, expect, test } from 'bun:test'
import { classifyImport, SHARED_MODULES } from '../src/externals'

describe('classifyImport', () => {
  test.each([...SHARED_MODULES])('keeps %p external', (specifier) => {
    expect(classifyImport(specifier)).toEqual({ kind: 'external' })
  })

  test('shares exactly the import map', () => {
    expect([...SHARED_MODULES]).toEqual([
      'react',
      'react/jsx-runtime',
      'react-dom',
      'react-dom/client',
      'motion',
      'motion/react',
      '@justanarthur/modo-ui',
      '@just-notch/sdk',
    ])
  })

  test.each(['@justanarthur/modo-ui/components/button', '@justanarthur/modo-ui/unocss', '@justanarthur/modo-ui/styles.css'])(
    'rejects the modo-ui subpath %p',
    (specifier) => {
      const rule = classifyImport(specifier)
      expect(rule.kind).toBe('error')
      expect(rule.kind === 'error' && rule.message).toContain('barrel "@justanarthur/modo-ui"')
    },
  )

  test.each(['react-dom/server', 'react/jsx-dev-runtime', 'motion/mini', '@just-notch/sdk/internal'])(
    'rejects the unshared subpath %p',
    (specifier) => {
      const rule = classifyImport(specifier)
      expect(rule.kind === 'error' && rule.message).toContain("not in the runtime's import map")
    },
  )

  test.each(['date-fns', 'date-fns/format', '@just-notch/bridge-schema', 'react-icons', 'motionless', '@justanarthur/modo'])(
    'bundles %p',
    (specifier) => {
      expect(classifyImport(specifier)).toEqual({ kind: 'bundle' })
    },
  )
})
