const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = require('../scripts/loadTypeScript.cjs')
const { hookHarness } = require('./helpers/hookHarness.cjs')
const { cases } = require('../../scripts/fsl_sandbox/caption_fixtures.json')
const { cases: v2Cases } = require('../../scripts/fsl_sandbox/caption_v2_fixtures.json')

const { previewLabCaption, previewLabCaptionV2 } = load('src/services/landmarks/labCaptions.ts')

test('browser caption preview matches the sandbox demo fixtures', () => {
  for (const fixture of cases) {
    const result = previewLabCaption(fixture.labels)
    assert.equal(result?.kind ?? 'fallback', fixture.expected.status, fixture.id)
    assert.equal(result?.caption ?? null, fixture.expected.caption ?? null, fixture.id)
  }
})

test('browser v2 preview matches sandbox v2 rules and preserves repetitions without duplicate request evidence', () => {
  for (const fixture of v2Cases) {
    const result = previewLabCaptionV2(fixture.events ?? fixture.labels.map(label => ({ label })))
    assert.equal(result?.kind ?? 'fallback', fixture.expected.status, fixture.id)
    assert.equal(result?.caption ?? null, fixture.expected.caption ?? null, fixture.id)
  }
  assert.equal(previewLabCaption(['TOMORROW', 'WAIT', 'PLEASE']), null)
})

function text(node) {
  if (Array.isArray(node)) return node.map(text).join(' ')
  if (typeof node === 'string') return node
  return node?.props ? text(node.props.children) : ''
}

test('Lab renders the caption immediately from confirmed signs and clears for a fresh run', () => {
  const jsx = (type, props) => ({ type, props })
  let transcript = []
  const harness = hookHarness('src/components/live/LabCaptionPreview.tsx', 'default', name => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: Symbol() }
    if (name.endsWith('/labCaptions')) return { previewLabCaption, previewLabCaptionV2 }
    throw Error(name)
  }, () => [{ transcript }])

  assert.match(text(harness.render()), /Sign one phrase per run/)
  transcript.push({ label: 'WAIT' })
  assert.match(text(harness.render()), /No caption rule matched/)
  transcript.push({ label: 'PLEASE' })
  assert.match(text(harness.render()), /Please wait\. Syntax demo/)
  transcript = [{ label: 'GOOD_MORNING' }]
  assert.match(text(harness.render()), /Good morning/)
  assert.doesNotMatch(text(harness.render()), /Please wait\./)
})

test('Lab changes caption rules for the same confirmed transcript', () => {
  const jsx = (type, props) => ({ type, props })
  const transcript = ['TOMORROW', 'WAIT', 'PLEASE'].map((label, index) => ({ label, requestId: String(index) }))
  let mode = 'v1'
  const harness = hookHarness('src/components/live/LabCaptionPreview.tsx', 'default', name => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: Symbol() }
    if (name.endsWith('/labCaptions')) return { previewLabCaption, previewLabCaptionV2 }
    throw Error(name)
  }, () => [{ transcript, mode }])

  assert.match(text(harness.render()), /No caption rule matched/)
  mode = 'v2'
  assert.match(text(harness.render()), /Please wait tomorrow\. Syntax template demo/)
})
