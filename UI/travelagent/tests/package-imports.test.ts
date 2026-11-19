import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
const { runtimeImports } = createRequire(import.meta.url)('../scripts/lib/runtime-imports.cjs')

test('package checks distinguish executable dependencies from code-generation strings', () => {
  const result = runtimeImports(`
    const generated = 'require("ajv/dist/runtime/validation_error")';
    const fs = require('node:fs');
    import './chunk.js';
    export { something } from './other.js';
    const later = import('./lazy.js');
    const missing = require('missing-module');
  `)
  assert.deepEqual([...result].toSorted(), [
    './chunk.js',
    './lazy.js',
    './other.js',
    'missing-module',
    'node:fs',
  ])
})
