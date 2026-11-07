import { describe, expect, it } from 'vitest'
import { commitMeta } from './commitMeta'

describe('commitMeta', () => {
  it('injects the commit as a meta tag in <head>', () => {
    const plugin = commitMeta('abc123')
    const transform = plugin.transformIndexHtml as () => unknown
    expect(transform()).toEqual([
      { tag: 'meta', attrs: { name: 'app-commit', content: 'abc123' }, injectTo: 'head' },
    ])
  })

  it('only runs for production builds', () => {
    expect(commitMeta('x').apply).toBe('build')
  })
})
