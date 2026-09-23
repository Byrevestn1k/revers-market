const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({ VITE_API_URL: "", VITE_HERE_API_KEY: "" })')
    module._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText, filename)
}
require.extensions['.css'] = () => {}
global.window = { location: { pathname: '/', search: '' }, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } }
global.localStorage = global.window.localStorage
require.cache[require.resolve('leaflet')] = { exports: {} }
const { default: App } = require('../src/App.tsx')
const page = renderToStaticMarkup(React.createElement(App))
assert.match(page, /ДещоТреба/)
console.log('App first render passed.')
