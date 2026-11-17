const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = require('../scripts/loadTypeScript.cjs')
const { hookHarness } = require('./helpers/hookHarness.cjs')

const glosses = load('src/services/landmarks/labGlosses.ts')
const makeEvent = (label, requestId) => ({ label, requestId, score: .92, decisionMs: 900 })

test('gloss suggestions retain signing order and numeric value, and deduplicate deliveries', () => {
  const firstWait = makeEvent('WAIT', 'first')
  const cases = [
    { events: [makeEvent('GOOD_MORNING', 'greeting')], expected: ['GOOD-MORNING'] },
    { events: [makeEvent('SIX', 'number')], expected: ['SIX'] },
    { events: [firstWait, firstWait, makeEvent('WAIT', 'second')], expected: ['WAIT', 'WAIT'] },
    { events: [firstWait, makeEvent('REST', 'rest'), makeEvent('PLEASE', 'please')], expected: ['WAIT', 'PLEASE'] },
  ]
  for (const { events, expected } of cases) {
    const suggestions = glosses.suggestLabGlosses(events, [])
    assert.deepEqual(Array.from(suggestions, token => token.gloss), expected)
    assert.equal(new Set(suggestions.map(token => token.id)).size, expected.length)
    assert.ok(suggestions.every(token => token.reviewStatus === 'pending' && token.timing === null))
  }
  const [number] = glosses.suggestLabGlosses(cases[1].events, [{ requestId: 'number', startMs: 400, endMs: 800 }])
  assert.equal(number.type, 'NUMBER')
  assert.equal(number.value, 6)
  assert.deepEqual({ ...number.timing }, { startMs: 400, endMs: 800 })
})

function find(root, predicate) {
  if (Array.isArray(root)) {
    for (const child of root) {
      const match = find(child, predicate)
      if (match) return match
    }
  } else if (root?.props) {
    if (predicate(root)) return root
    return find(root.props.children, predicate)
  }
}

test('Lab editor saves manual spans, links reduplication and preserves repeated letters in JSON', () => {
  const first = { type: 'LEXICAL', reviewStatus: 'reviewed', id: 'first', gloss: 'WAIT',
    glossId: 'test-wait', startMs: 100, endMs: 500 }
  const second = { ...first, id: 'second', startMs: 800, endMs: 1200 }
  let annotations = [first, second]
  let playhead = 1300
  const props = () => [{ suggestions: [], annotations, onChange: next => { annotations = next },
    durationMs: 3000, running: false, modelMode: 'lab-signs43-similarity', readPlayhead: () => playhead }]
  const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props }
  const harness = hookHarness('src/components/live/LabGlossTrack.tsx', 'default', name => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: Symbol() }
    if (name.endsWith('/labGlosses')) return glosses
    if (name.endsWith('/Button')) return { default: 'Button' }
    throw Error(name)
  }, props)
  const get = predicate => {
    const match = find(harness.render(), predicate)
    assert.ok(match)
    return match.props
  }
  const click = label => get(node => node.type === 'Button' && [node.props.children].flat().join('') === label).onClick()
  const field = (label, type) => {
    const container = get(node => node.type === 'label' && [node.props.children].flat().includes(label))
    return find(container.children, node => node.type === type).props
  }
  const change = (label, value, type = 'input') => field(label, type).onChange({ target: { value } })
  const save = () => get(node => node.type === 'form').onSubmit({ preventDefault() {} })
  click('Add annotation')
  click('Set start from video')
  playhead = 1550
  click('Set end from video')
  change('Reason (optional)', 'Outside vocabulary')
  change('End (s)', '3.1')
  save()
  assert.equal(annotations.length, 2)
  assert.match(get(node => node.props.role === 'alert').children, /within the recording/)
  change('End (s)', '1.55')
  save()
  assert.equal(annotations.find(token => token.type === 'UNRESOLVED').startMs, 1300)

  click('Add annotation')
  change('Token type', 'REDUPLICATION', 'select')
  change('Start (s)', '0.1')
  change('End (s)', '1.2')
  change('Repeat count (optional)', '2')
  for (let i = 0; i < 2; i++) {
    get(node => node.type === 'input' && node.props.type === 'checkbox' && !node.props.checked)
      .onChange({ target: { checked: true } })
  }
  save()
  click('Add annotation')
  change('Token type', 'FINGERSPELLING', 'select')
  change('Start (s)', '2')
  change('End (s)', '2.8')
  change('Letters', 'A-N-N-A')
  save()
  const exported = JSON.parse(JSON.stringify(glosses.labGlossReport('video', 3000, [], annotations)))
  const span = exported.annotations.find(token => token.type === 'REDUPLICATION')
  assert.deepEqual(span.componentIds, ['first', 'second'])
  assert.deepEqual(exported.annotations.find(token => token.type === 'FINGERSPELLING').letters, ['A', 'N', 'N', 'A'])
  assert.equal(exported.annotations.length, 5)
  const afterRemoval = glosses.updateGlossAnnotations(annotations, 'first')
  assert.deepEqual(Array.from(afterRemoval.find(token => token.id === span.id).componentIds), ['second'])
})
