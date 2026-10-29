const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const output = {}
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/shared/SecondsInput.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText
vm.runInNewContext(code, { exports: output, require: name => name === 'react'
  ? { useState: value => [value, () => {}], useEffect: () => {} } : require(name) })
test('seconds input accepts custom values and rejects invalid timing values', () => {
  const changes = []
  const input = output.default({ value: 3, label: 'Delay', onChange: value => changes.push(value) })
  for (const value of [7, 0, 120, -1, 121, 1.5, NaN, Infinity]) input.props.onChange({ target: { value: String(value), valueAsNumber: value } })
  assert.deepEqual(changes, [7, 0, 120])
  const duration = output.default({ value: 0, label: 'Duration', step: .1, onChange: value => changes.push(value) })
  duration.props.onChange({ target: { value: '2.5', valueAsNumber: 2.5 } })
  assert.equal(changes.at(-1), 2.5)
})
