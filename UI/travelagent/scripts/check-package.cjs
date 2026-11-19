const assert = require('node:assert/strict')
const path = require('node:path')
const { builtinModules } = require('node:module')
const asar = require('@electron/asar')
const { runtimeImports } = require('./lib/runtime-imports.cjs')
const archive = path.resolve(process.argv[2] || 'out/TravelAgent-win32-x64/resources/app.asar')
const entries = asar
  .listPackage(archive)
  .map((name) => name.replaceAll('\\', '/').replace(/^\//, ''))
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))
const checked = new Set()
for (const entry of entries.filter((name) => /\.[cm]?js$/.test(name))) {
  const code = asar.extractFile(archive, path.normalize(entry)).toString('utf8')
  for (const specifier of runtimeImports(code)) {
    if (specifier.startsWith('.')) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(entry), specifier))
      assert.ok(entries.includes(target), `Missing bundled file: ${entry} -> ${specifier}`)
    } else {
      assert.ok(
        specifier === 'electron' || builtins.has(specifier),
        `Unbundled runtime dependency: ${entry} -> ${specifier}`,
      )
      checked.add(specifier)
    }
  }
}
assert.ok(entries.includes('.vite/build/main.cjs'), 'Missing main entry')
assert.ok(entries.includes('.vite/build/preload.cjs'), 'Missing preload entry')
assert.ok(entries.includes('.vite/renderer/main_window/index.html'), 'Missing renderer entry')
console.log(
  `Package dependency check passed (${entries.length} entries, ${checked.size} runtime modules).`,
)
