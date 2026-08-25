import * as esbuild from 'esbuild'
import { cp, mkdir, rm } from 'node:fs/promises'

await rm('dist', { recursive: true, force: true })
await mkdir('dist', { recursive: true })

await esbuild.build({
  entryPoints: {
    'content-app': 'src/content-app.ts',
    'content-espn': 'src/content-espn.ts',
    'content-espn-page': 'src/content-espn-page.ts',
    popup: 'src/popup.ts',
  },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  sourcemap: true,
  logLevel: 'info',
})

await cp('src/manifest.json', 'dist/manifest.json')
await cp('src/popup.html', 'dist/popup.html')
await cp('src/popup.css', 'dist/popup.css')
await cp('src/panel.css', 'dist/panel.css')
