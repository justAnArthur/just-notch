import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['src/**/*.test.ts', 'bundler/**/*.test.ts'], environment: 'node' } })
