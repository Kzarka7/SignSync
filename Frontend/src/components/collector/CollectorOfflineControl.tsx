import { useEffect, useState } from 'react'
import Button from '../shared/Button'

const workerPath = '/collector-offline-worker.js'
const manifestPath = '/collector-offline-assets.json'
const cacheName = 'signsync-collector-offline-v1'

function hasCollectorWorker() {
  return navigator.serviceWorker.controller?.scriptURL === new URL(workerPath, location.href).href
}

function matchesCurrentBuild(files: string[]) {
  const entry = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src
  return !!entry && files.some(file => new URL(file, location.href).href === entry)
}

function waitForCollectorWorker() {
  const workers = navigator.serviceWorker
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      workers.removeEventListener('controllerchange', check)
      reject(new Error('Offline setup could not take control of this tab. Reload and try again.'))
    }, 10_000)
    function check() {
      if (!hasCollectorWorker()) return
      window.clearTimeout(timeout)
      workers.removeEventListener('controllerchange', check)
      resolve()
    }
    workers.addEventListener('controllerchange', check)
    check()
  })
}

export default function CollectorOfflineControl() {
  const supported = 'serviceWorker' in navigator && 'caches' in window
  const [ready, setReady] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (import.meta.env.DEV || !supported || !hasCollectorWorker()) return
    let mounted = true
    void (async () => {
      const cache = await caches.open(cacheName)
      const manifest = await cache.match(manifestPath)
      if (!manifest) return
      const files: string[] = await manifest.json()
      const available = matchesCurrentBuild(files) && (await Promise.all(files.map(file => cache.match(file)))).every(Boolean)
      if (mounted) setReady(available)
    })().catch(() => {})
    return () => { mounted = false }
  }, [supported])

  async function prepare() {
    setPreparing(true)
    setError('')
    try {
      const manifest = await fetch(manifestPath, { cache: 'reload' })
      if (!manifest.ok) throw new Error('The offline asset list is unavailable.')
      const files: string[] = await manifest.clone().json()
      if (!matchesCurrentBuild(files)) throw new Error('Reload to the latest app version before preparing offline files.')
      const cache = await caches.open(cacheName)
      await cache.addAll(files.map(file => new Request(file, { cache: 'reload' })))
      // A static host can return its HTML fallback for a missing asset.
      for (const file of files) {
        const asset = await cache.match(file)
        if (!asset || (!file.endsWith('.html') && asset.headers.get('content-type')?.includes('text/html'))) {
          if (asset) await cache.delete(file)
          throw new Error(`The offline asset ${file} is unavailable.`)
        }
      }
      await navigator.serviceWorker.register(workerPath)
      await waitForCollectorWorker()
      await cache.put(manifestPath, manifest)
      setReady(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Offline preparation failed. Reconnect and try again.')
    } finally {
      setPreparing(false)
    }
  }

  if (import.meta.env.DEV) return null
  return <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
    {ready ? <p role="status" className="font-semibold text-success-dark">Offline ready</p>
      : supported ? <Button size="sm" disabled={preparing} onClick={() => void prepare()}>
        {preparing ? 'Preparing offline files…' : 'Prepare for offline use'}
      </Button> : <p>Offline setup requires HTTPS or localhost and browser storage.</p>}
    {error && <p role="alert" className="text-danger">{error}</p>}
  </div>
}
