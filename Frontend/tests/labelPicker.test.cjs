const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function pickerHarness() {
  let selected = 'HELLO', disabled = false, cursor = 0
  const slots = []
  const selections = []
  const react = {
    memo: component => component,
    useId: () => 'label-picker',
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = initial
      return [slots[index], value => { slots[index] = value }]
    },
    useRef(initial) {
      const index = cursor++
      return slots[index] ??= { current: initial }
    },
  }
  function load(file) {
    const exports = {}
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText
    vm.runInNewContext(code, { exports, require: name => {
      if (name === 'react') return react
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'))
      return require(name)
    } })
    return exports
  }
  const Picker = load(path.resolve(__dirname, '../src/components/collector/LabelPicker.tsx')).default
  const labels = ['HELLO', 'THANK_YOU', 'ONE', 'TEN', 'JANUARY', 'GOOD_MORNING', 'GOOD_AFTERNOON', 'GOOD_EVENING']
  function nodes(node) {
    if (Array.isArray(node)) return node.flatMap(nodes)
    if (!node || typeof node !== 'object') return []
    return [node, ...[].concat(node.props?.children ?? []).flatMap(nodes)]
  }
  function render() {
    cursor = 0
    return nodes(Picker({ knownLabels: labels, selectedLabel: selected, disabled,
      onSelectLabel: label => { selected = label; selections.push(label) } }))
  }
  return {
    render, selections,
    selected: () => selected,
    disable: () => { disabled = true },
    input: () => render().find(node => node.type === 'input'),
    options: () => render().filter(node => node.props?.role === 'option'),
    open() { this.input().props.onFocus({ currentTarget: { select() {} } }) },
    key(key) { this.input().props.onKeyDown({ key, nativeEvent: { isComposing: false }, preventDefault() {} }) },
    search(value) { this.input().props.onChange({ currentTarget: { value } }) },
  }
}

test('sign search auto-selects names, unique fragments, and numeric aliases', () => {
  const h = pickerHarness()
  for (const [query, expected] of [['jan', 'JANUARY'], [' good morning ', 'GOOD_MORNING'],
    ['good-evening', 'GOOD_EVENING'], ['thank_you', 'THANK_YOU'], ['1', 'ONE'], ['10', 'TEN']]) {
    h.search(query)
    assert.equal(h.selected(), expected)
    assert.deepEqual(h.options().map(node => node.props.children[0]), [expected])
  }
})

test('typing HELLO filters the same dropdown to HELLO only', () => {
  const h = pickerHarness()
  h.open()
  assert.equal(h.options().length, 8)
  assert.equal(h.render().filter(node => node.type === 'input').length, 1)
  h.search('HELLO')
  assert.equal(h.input().props.role, 'combobox')
  assert.equal(h.selected(), 'HELLO')
  assert.deepEqual(h.options().map(node => node.props.children[0]), ['HELLO'])
})

test('ambiguous and unmatched searches clear assignment and options can be selected directly', () => {
  const h = pickerHarness()
  h.search('good')
  assert.equal(h.selected(), '')
  assert.equal(h.options().length, 3)
  h.options()[1].props.onClick()
  assert.equal(h.selected(), 'GOOD_AFTERNOON')
  assert.equal(h.input().props.value, 'GOOD_AFTERNOON')
  assert.equal(h.input().props['aria-expanded'], false)
  h.search('not-a-sign')
  assert.equal(h.selected(), '')
  assert.equal(h.options().length, 0)
  assert.ok(h.render().some(node => node.props?.role === 'status' && /No matching/.test(node.props.children)))
})

test('arrow keys and Enter choose a filtered result; Escape restores the previous label', () => {
  const h = pickerHarness()
  h.open(); h.search('good'); h.key('ArrowDown'); h.key('ArrowDown'); h.key('Enter')
  assert.equal(h.selected(), 'GOOD_AFTERNOON')
  assert.equal(h.input().props['aria-expanded'], false)
  h.open(); h.search('jan'); h.key('Escape')
  assert.equal(h.selected(), 'GOOD_AFTERNOON')
  assert.equal(h.input().props.value, 'GOOD_AFTERNOON')
  h.open(); h.search('good'); h.key('ArrowUp'); h.key('Enter')
  assert.equal(h.selected(), 'GOOD_EVENING')
})

test('clearing lists all signs without retaining an assignment and locked controls cannot select', () => {
  const h = pickerHarness()
  h.search('jan'); h.search('')
  assert.equal(h.selected(), '')
  assert.equal(h.options().length, 8)
  h.search('jan'); h.disable()
  assert.equal(h.input().props.disabled, true)
  assert.equal(h.input().props['aria-expanded'], false)
  h.search('10'); h.key('ArrowDown'); h.key('Enter')
  assert.equal(h.selected(), 'JANUARY')
})
