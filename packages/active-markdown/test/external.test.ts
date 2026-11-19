import test from 'node:test'
import assert from 'node:assert/strict'

import { openExternal } from '../client/src/external.ts'

const URL = 'https://example.com/doc'

test('外部链接交给侧栏浏览器，弹新标签页是最后手段', () => {
  const opened: Array<[string, unknown]> = []
  const fallback: string[] = []
  openExternal(
    URL,
    { openTab: (kind, options) => { opened.push([kind, options]) } },
    url => { fallback.push(url) },
  )
  assert.deepEqual(opened, [['browser', { params: { url: URL } }]])
  assert.deepEqual(fallback, [])
})

test('侧栏服务缺失时退回新标签页', () => {
  const fallback: string[] = []
  openExternal(URL, undefined, url => { fallback.push(url) })
  assert.deepEqual(fallback, [URL])
})

test('侧栏打不开页面时退回新标签页', () => {
  const fallback: string[] = []
  openExternal(URL, {
    openTab: () => { throw new Error('sidebarRight: the "browser" tab kind is not registered') },
  }, url => { fallback.push(url) })
  assert.deepEqual(fallback, [URL])
})

test('没有会话可开时打开失败不吞掉链接', () => {
  const fallback: string[] = []
  openExternal(URL, {
    openTab: () => { throw new Error('sidebarRight: no session on screen') },
  }, url => { fallback.push(url) })
  assert.deepEqual(fallback, [URL])
})
