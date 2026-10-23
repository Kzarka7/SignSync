// Run: node scripts/checkIndexedDbStorage.cjs <path-to-playwright>
// Uses an isolated browser context and generated landmarks, never real datasets.
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
async function main() {
  process.chdir(path.resolve(__dirname, '..'))
  const { chromium } = require(process.argv[2] || 'playwright')
  const { createServer } = await import(pathToFileURL(path.resolve(__dirname, '../node_modules/vite/dist/node/index.js')))
  const server = await createServer({ root: path.resolve(__dirname, '..'), server: { host: '127.0.0.1', port: 5197, strictPort: true, hmr: false } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: 'msedge', headless: true })
    const page = await browser.newPage()
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    await page.goto('http://127.0.0.1:5197/dataset-collector')
    const bytes = await page.evaluate(async () => {
      const storage = await import('/src/services/dataset/datasetStorage.ts')
      const points = Array.from({ length: 21 }, (_, i) => ({ x: i / 21, y: .123456789, z: -.01234567 }))
      const frames = Array.from({ length: 100 }, (_, i) => ({ timestamp: i * 50, raw: { timestamp: i * 50, pose: null, leftHand: points, rightHand: points } }))
      const samples = Array.from({ length: 40 }, (_, i) => ({ id: 'browser-' + i, label: 'HELLO', createdAt: '2026-10-23T00:00:00Z', durationMs: 4950, frames,
        videoImport: { fingerprint: 'browser-source-' + i, filename: i + '.mp4', trimStartMs: 0, trimEndMs: 4950, quality: { result: 'Pass', findings: [] }, review: { completeSign: true } } }))
      localStorage.setItem('daloy:dataset-sequences', JSON.stringify(samples.slice(0, 2)))
      const migrated = await storage.getSequences()
      if (migrated.length !== 2 || localStorage.getItem('daloy:dataset-sequences') !== null) throw Error('Migration failed')
      // Replay a legacy snapshot to verify idempotence in the real browser.
      localStorage.setItem('daloy:dataset-sequences', JSON.stringify(samples.slice(0, 2)))
      if ((await storage.getSequences()).length !== 2) throw Error('Migration duplicated samples')
      for (const sample of samples.slice(2)) await storage.saveSequence(sample)
      await storage.saveSequence({ ...samples[0], evaluation: { taskId: 'pilot' } }, 'evaluation')
      return new Blob([JSON.stringify(samples)]).size
    })
    assert.ok(bytes > 5 * 1024 * 1024)
    await page.reload()
    await page.locator('summary:visible').filter({ hasText: 'Recorded samples (40)' }).waitFor()
    await page.getByRole('button', { name: 'Prepare ZIP', exact: true }).click()
    await page.getByRole('button', { name: 'Export as ZIP', exact: true }).waitFor({ timeout: 30000 })
    const downloaded = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export as ZIP', exact: true }).click()
    const download = await downloaded, stream = await download.createReadStream(), chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    const zip = await require('jszip').loadAsync(Buffer.concat(chunks))
    const entries = Object.values(zip.files).filter(file => !file.dir)
    assert.equal(entries.length, 40)
    for (const entry of entries) {
      const payload = JSON.parse(await entry.async('string')).sequences[0]
      assert.equal(payload.frames.length, 100)
      assert.ok(payload.videoImport.review.completeSign)
    }
    await page.getByRole('button', { name: 'Delete HELLO sample', exact: true }).first().click()
    await page.locator('summary:visible').filter({ hasText: 'Recorded samples (39)' }).waitFor()
    await page.reload()
    await page.locator('summary:visible').filter({ hasText: 'Recorded samples (39)' }).waitFor()
    const ids = await page.evaluate(async () => (await (await import('/src/services/dataset/datasetStorage.ts')).getSequences()).map(s => s.id))
    assert.deepEqual(ids, Array.from({ length: 39 }, (_, i) => 'browser-' + (i + 1)))
    await page.getByRole('button', { name: 'Clear all', exact: true }).click()
    await page.locator('p:visible').filter({ hasText: /^No saved samples yet$/ }).waitFor()
    const evaluationCount = await page.evaluate(async () => (await (await import('/src/services/dataset/datasetStorage.ts')).getSequences('evaluation')).length)
    assert.equal(evaluationCount, 1)
    await page.evaluate(() => localStorage.setItem('daloy:dataset-sequences', '{broken'))
    await page.reload()
    await page.getByRole('alert').filter({ hasText: 'Original localStorage data has been preserved' }).last().waitFor()
    assert.equal(await page.evaluate(() => localStorage.getItem('daloy:dataset-sequences')), '{broken')
    await page.evaluate(() => localStorage.removeItem('daloy:dataset-sequences'))
    await page.getByRole('button', { name: 'Retry loading samples' }).click()
    await page.locator('p:visible').filter({ hasText: /^No saved samples yet$/ }).waitFor()
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ browser: 'Edge', samples: 40, sourceJsonBytes: bytes, zipEntries: entries.length, migration: 'passed', repeatMigration: 'passed', reload: 'passed', order: 'passed', deletion: 'passed', clear: 'passed', evaluationIsolation: 'passed', pageErrors: errors }))
  } finally { await browser?.close(); await server.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
