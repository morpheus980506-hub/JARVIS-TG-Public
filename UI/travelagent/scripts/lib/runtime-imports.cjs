const { parse } = require('acorn')
const { simple } = require('acorn-walk')

// Inspect executable imports, not require(...) text embedded in generated-code strings.
function runtimeImports(code) {
  const imports = new Set()
  const add = (node) => {
    if (node?.type === 'Literal' && typeof node.value === 'string') imports.add(node.value)
  }
  simple(parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }), {
    CallExpression(node) {
      if (node.callee.type === 'Identifier' && node.callee.name === 'require')
        add(node.arguments[0])
    },
    ImportDeclaration(node) {
      add(node.source)
    },
    ExportNamedDeclaration(node) {
      add(node.source)
    },
    ExportAllDeclaration(node) {
      add(node.source)
    },
    ImportExpression(node) {
      add(node.source)
    },
  })
  return imports
}
module.exports = { runtimeImports }
