import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

function collectorOfflineAssets(): Plugin {
  const require = createRequire(import.meta.url)
  const visionRoot = dirname(require.resolve('@mediapipe/tasks-vision'))
  const version = JSON.parse(readFileSync(join(visionRoot, 'package.json'), 'utf8')).version
  const wasmDir = join(visionRoot, 'wasm')
  const prefix = `vision/${version}`
  const wasmFiles = readdirSync(wasmDir).filter(name => /\.(js|wasm)$/.test(name))
  const models = ['hand_landmarker.task', 'pose_landmarker_lite.task']
  return {
    name: 'collector-offline-assets',
    enforce: 'post',
    configureServer(server) {
      server.middlewares.use(`/${prefix}/wasm`, (request, response, next) => {
        const name = request.url?.split('?')[0].slice(1)
        if (!name || !wasmFiles.includes(name)) return next()
        response.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
        response.end(readFileSync(join(wasmDir, name)))
      })
    },
    generateBundle(_options, bundle) {
      for (const name of wasmFiles) {
        this.emitFile({ type: 'asset', fileName: `${prefix}/wasm/${name}`, source: readFileSync(join(wasmDir, name)) })
      }
      const files = [...new Set(['index.html', ...Object.keys(bundle),
        ...wasmFiles.map(name => `${prefix}/wasm/${name}`), ...models.map(name => `${prefix}/${name}`)])]
      this.emitFile({ type: 'asset', fileName: 'collector-offline-assets.json', source: JSON.stringify(files.map(file => `/${file}`)) })
    },
  }
}

export default defineConfig({
  plugins: [react(), collectorOfflineAssets()],
  server: { port: 5173 },
  preview: {
    allowedHosts: process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS
      ? [process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS]
      : undefined,
  },
})
