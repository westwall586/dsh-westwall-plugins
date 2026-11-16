import test from 'node:test'
import assert from 'node:assert/strict'

import { imageMediaType, isRemoteSource, localImagePath } from '../client/src/images.ts'

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values)

test('按魔数嗅探常见位图', () => {
  assert.equal(imageMediaType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), 'image/png')
  assert.equal(imageMediaType(bytes(0xff, 0xd8, 0xff, 0xe0)), 'image/jpeg')
  assert.equal(imageMediaType(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)), 'image/gif')
  assert.equal(imageMediaType(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50)), 'image/webp')
  assert.equal(imageMediaType(bytes(0x42, 0x4d, 0x36)), 'image/bmp')
  assert.equal(imageMediaType(bytes(0x00, 0x00, 0x01, 0x00)), 'image/x-icon')
})

test('SVG 以文本判断', () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
  assert.equal(imageMediaType(svg), 'image/svg+xml')
  assert.equal(imageMediaType(new TextEncoder().encode('not an image')), undefined)
})

test('远程地址与本地路径分开', () => {
  assert.equal(isRemoteSource('https://example.com/a.png'), true)
  assert.equal(isRemoteSource('//example.com/a.png'), true)
  assert.equal(isRemoteSource('file:///tmp/a.png'), false)
  assert.equal(isRemoteSource('C:\\docs\\a.png'), false)
  assert.equal(localImagePath('C:\\docs\\a.png'), 'C:\\docs\\a.png')
})

test('本地路径去掉查询与片段并解码', () => {
  assert.equal(localImagePath('img/a%20b.png?x=1#f'), 'img/a b.png')
  assert.equal(localImagePath('https://example.com/a.png'), undefined)
  assert.equal(localImagePath(''), undefined)
})
