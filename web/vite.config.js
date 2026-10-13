import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// The 3D scan viewers, splat PLYs and the Pheno4D point cloud already live in
// ../docs (committed, ~150 MB). We serve them at /twin-assets/* instead of
// copying them into web/, and copy them into dist/ only at build time.
const DOCS = path.resolve(import.meta.dirname, '../docs')
const SHARED = ['viewer', 'viewer-garden', 'pitch']

const MIME = {
  '.html': 'text/html', '.json': 'application/json', '.mp4': 'video/mp4',
  '.png': 'image/png', '.ply': 'application/octet-stream', '.bin': 'application/octet-stream',
}

function twinAssets() {
  const serve = (req, res, next) => {
    if (!req.url.startsWith('/twin-assets/')) return next()
    const rel = decodeURIComponent(req.url.split('?')[0].slice('/twin-assets/'.length))
    const file = path.join(DOCS, rel.endsWith('/') ? rel + 'index.html' : rel)
    if (!file.startsWith(DOCS) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return next()
    const { size } = fs.statSync(file)
    const type = MIME[path.extname(file)] || 'application/octet-stream'
    const range = req.headers.range
    if (range) {                                   // video scrubbing needs ranges
      const [s, e] = range.replace('bytes=', '').split('-')
      const start = parseInt(s, 10), end = e ? parseInt(e, 10) : size - 1
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': type })
      fs.createReadStream(file, { start, end }).pipe(res)
    } else {
      res.writeHead(200, { 'Content-Length': size, 'Content-Type': type, 'Accept-Ranges': 'bytes' })
      fs.createReadStream(file).pipe(res)
    }
  }
  return {
    name: 'twin-assets',
    configureServer(server) { server.middlewares.use(serve) },
    configurePreviewServer(server) { server.middlewares.use(serve) },
    closeBundle() {
      const out = path.resolve(import.meta.dirname, 'dist/twin-assets')
      for (const dir of SHARED) {
        const src = path.join(DOCS, dir)
        if (fs.existsSync(src)) fs.cpSync(src, path.join(out, dir), { recursive: true })
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), twinAssets()],
  server: { port: 5173, host: true, proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true } } },
  preview: { proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true } } },
  build: { chunkSizeWarningLimit: 1600 },
})
