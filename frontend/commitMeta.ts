import type { Plugin } from 'vite'

// Stamps the deployed commit into index.html (Render sets RENDER_GIT_COMMIT
// at build time) so the deploy workflow's smoke check can tell the new build
// from the one it replaces.
export function commitMeta(commit = process.env.RENDER_GIT_COMMIT ?? ''): Plugin {
  return {
    name: 'commit-meta',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { name: 'app-commit', content: commit }, injectTo: 'head' },
    ],
  }
}
