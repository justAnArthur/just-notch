import { describe, expect, test } from 'bun:test'
import { isSemverRange, validateManifest } from '../src/manifest'

const valid = {
  id: 'demo-hello',
  name: 'Demo Hello',
  version: '0.1.0',
  entry: 'dist/index.js',
  style: 'dist/index.css',
  permissions: ['media.read', 'files'],
  engines: { notch: '^0.1.0' },
}

describe('validateManifest', () => {
  test('accepts a valid manifest', () => {
    const result = validateManifest(valid, { folder: 'demo-hello' })
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.manifest?.id).toBe('demo-hello')
  })

  test('style is optional', () => {
    const { style: _, ...rest } = valid
    expect(validateManifest(rest).errors).toEqual([])
  })

  test('rejects a non-object', () => {
    expect(validateManifest([]).errors).toEqual(['manifest.json must hold a JSON object'])
    expect(validateManifest(null).manifest).toBeUndefined()
  })

  test.each(['Demo', 'demo_hello', 'demo--hello', '-demo', 'demo-', ''])('rejects id %p', (id) => {
    expect(validateManifest({ ...valid, id }).errors[0]).toContain('"id" must be kebab-case')
  })

  test('requires id to match the folder', () => {
    expect(validateManifest(valid, { folder: 'other' }).errors).toEqual([
      '"id" is "demo-hello" but the plugin folder is "other": they must match',
    ])
  })

  test.each(['1.0', 'v1.0.0', '01.0.0', '1.0.0-'])('rejects version %p', (version) => {
    expect(validateManifest({ ...valid, version }).errors[0]).toContain('"version" must be semver')
  })

  test('accepts prerelease and build versions', () => {
    expect(validateManifest({ ...valid, version: '1.2.3-beta.1+sha.5' }).errors).toEqual([])
  })

  test.each(['/abs/index.js', '../index.js', 'dist/../x.js', './dist/index.js', 'dist\\index.js'])('rejects entry %p', (entry) => {
    expect(validateManifest({ ...valid, entry }).errors[0]).toContain('relative path inside the plugin')
  })

  test('entry must be .js, style .css', () => {
    expect(validateManifest({ ...valid, entry: 'dist/index.ts', style: 'dist/index.js' }).errors).toEqual([
      '"entry" must point at a .js file (got "dist/index.ts")',
      '"style" must point at a .css file (got "dist/index.js")',
    ])
  })

  test('rejects unknown permissions and a missing array', () => {
    expect(validateManifest({ ...valid, permissions: ['media.read', 'camera'] }).errors[0]).toStartWith(
      'unknown permission "camera"',
    )
    expect(validateManifest({ ...valid, permissions: undefined }).errors).toEqual([
      '"permissions" must be an array (use [] for none)',
    ])
  })

  test('warns on duplicate permissions and unknown fields', () => {
    const result = validateManifest({ ...valid, permissions: ['hud', 'hud'], main: 'x' })
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual(['duplicate permissions: hud', 'unknown field "main" is ignored'])
  })

  test('accepts hosts with the net permission', () => {
    const result = validateManifest({ ...valid, permissions: ['net', 'secrets'], hosts: ['api.github.com', '*.youtrack.cloud', 'host:8443'] })
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.manifest?.hosts).toEqual(['api.github.com', '*.youtrack.cloud', 'host:8443'])
  })

  test.each(['https://api.github.com', 'api.github.com/x', '*.com', '*', 'API.github.com', 42])('rejects host %p', (host) => {
    expect(validateManifest({ ...valid, permissions: ['net'], hosts: [host] }).errors[0]).toStartWith(`invalid host ${JSON.stringify(host)}`)
  })

  test('hosts without net is an error; net without hosts a warning', () => {
    expect(validateManifest({ ...valid, hosts: ['api.github.com'] }).errors).toEqual(['"hosts" needs the "net" permission'])
    expect(validateManifest({ ...valid, permissions: ['net'], hosts: 'api.github.com' }).errors).toEqual([
      '"hosts" must be an array of hostnames like "api.github.com"',
    ])
    const bare = validateManifest({ ...valid, permissions: ['net'] })
    expect(bare.errors).toEqual([])
    expect(bare.warnings).toEqual(['"net" without "hosts": every host must be granted by the user through ctx.net.requestHost'])
  })

  test('requires engines.notch to be a range', () => {
    expect(validateManifest({ ...valid, engines: {} }).errors).toEqual(['"engines.notch" must be a semver range like "^0.1.0"'])
    expect(validateManifest({ ...valid, engines: { notch: 'latest' } }).errors).toEqual([
      '"engines.notch" is not a semver range (got "latest")',
    ])
  })

  test('reports every problem at once', () => {
    expect(validateManifest({}).errors).toHaveLength(6)
  })
})

describe('isSemverRange', () => {
  test.each(['^0.1.0', '~1.2', '>=1.0.0 <2.0.0', '1.x', '*', '1.0.0 - 2.0.0', '^1.0.0 || ^2.0.0', '0.1.0'])('accepts %p', (r) => {
    expect(isSemverRange(r)).toBe(true)
  })

  test.each(['', 'latest', '^', '>= 1.0.0', '1.0.0 ||'])('rejects %p', (r) => {
    expect(isSemverRange(r)).toBe(false)
  })
})
