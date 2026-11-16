import test from 'node:test'
import assert from 'node:assert/strict'

import { classifyLink, resolvePath } from '../client/src/links.ts'

const DOC = '/work/docs/a.md'
const classify = (href: string) => classifyLink(href, 's1', DOC)

test('片段链接指向标题锚点', () => {
  assert.deepEqual(classify('#安装'), { kind: 'anchor', id: '安装' })
})

test('http、https、mailto 走外部窗口', () => {
  assert.deepEqual(classify('https://example.com/x'), { kind: 'external', url: 'https://example.com/x' })
  assert.deepEqual(classify('mailto:a@b.c'), { kind: 'external', url: 'mailto:a@b.c' })
  assert.deepEqual(classify('//example.com/x'), { kind: 'external', url: 'https://example.com/x' })
})

test('未知协议一律不执行', () => {
  assert.deepEqual(classify('javascript:alert(1)'), { kind: 'blocked' })
  assert.deepEqual(classify('data:text/html,x'), { kind: 'blocked' })
  assert.deepEqual(classify(''), { kind: 'blocked' })
})

test('资源地址原样交给侧栏', () => {
  assert.deepEqual(classify('dsh-resource://file/session/s1/x.md'), {
    kind: 'resource',
    address: 'dsh-resource://file/session/s1/x.md',
  })
})

test('相对文件按文档目录解析成会话地址', () => {
  assert.deepEqual(classify('./b.md'), { kind: 'file', address: 'dsh-resource://file/session/s1//work/docs/b.md' })
  assert.deepEqual(classify('b.md?x=1#frag'), { kind: 'file', address: 'dsh-resource://file/session/s1//work/docs/b.md' })
  assert.deepEqual(classify('my%20doc.md'), { kind: 'file', address: 'dsh-resource://file/session/s1//work/docs/my%20doc.md' })
  assert.deepEqual(classify('/etc/hosts'), { kind: 'file', address: 'dsh-resource://file/session/s1//etc/hosts' })
})

test('Windows 绝对路径不当成协议', () => {
  assert.deepEqual(classify('C:\\docs\\x.md'), { kind: 'file', address: 'dsh-resource://file/session/s1/C:/docs/x.md' })
})

test('向上越界的相对路径不打开', () => {
  assert.equal(resolvePath('/work/docs/a.md', '../../../x.md'), undefined)
  assert.deepEqual(classify('../../../x.md'), { kind: 'blocked' })
})

test('resolvePath 处理点段与工作区相对路径', () => {
  assert.equal(resolvePath('/work/docs/a.md', '../b.md'), '/work/b.md')
  assert.equal(resolvePath('docs/a.md', 'img/x.png'), 'docs/img/x.png')
  assert.equal(resolvePath('a.md', 'img/x.png'), 'img/x.png')
})
