import { test } from 'node:test'
import assert from 'node:assert/strict'

const { CLIENT_CONTRIBUTION, createCopyApi } = await import('../client/src/remote.mjs')

test('the client contribution exposes the three copy methods', () => {
  assert.equal(CLIENT_CONTRIBUTION.package, 'dsh-web-clipper')
  assert.deepEqual(CLIENT_CONTRIBUTION.descriptors.map(row => row.method), [
    'directory', 'saveCopy', 'openDirectory',
  ])
  for (const row of CLIENT_CONTRIBUTION.descriptors) {
    assert.equal(row.service, 'webClipper')
    assert.equal(row.namespace, 'webClipper')
    assert.equal(row.invocation.kind, 'direct')
  }
})

test('the copy facade mounts once and unwraps Remote values', async () => {
  let mounts = 0
  let calls = []
  const ctx = {
    remote: {
      $mount: async () => {
        mounts += 1
      },
    },
    inject: (_names, callback) => {
      const value = {
        saveCopy: async (name, content) => {
          calls.push({ name, content })
          return { ok: true, value: { ok: true, path: '/tmp/x.md', directory: '/tmp', isDefault: true } }
        },
        directory: async () => ({ ok: true, value: { ok: true, configured: '', resolved: '/tmp', isDefault: true } }),
        openDirectory: async () => ({ ok: true, value: { ok: true, path: '/tmp' } }),
      }
      callback({ remote: { webClipper: value } })
      return () => {}
    },
  }
  const api = createCopyApi(ctx)
  const saved = await api.save('x.md', 'body')
  const directory = await api.directory()
  const opened = await api.open()
  assert.equal(mounts, 1)
  assert.deepEqual(calls, [{ name: 'x.md', content: 'body' }])
  assert.equal(saved.path, '/tmp/x.md')
  assert.equal(directory.resolved, '/tmp')
  assert.equal(opened.path, '/tmp')
})

test('a Remote failure keeps its code', async () => {
  const ctx = {
    remote: { $mount: async () => {} },
    inject: (_names, callback) => {
      callback({ remote: { webClipper: {
        saveCopy: async () => ({ ok: false, error: { code: 'write-failed', message: 'disk full' } }),
      } } })
      return () => {}
    },
  }
  await assert.rejects(createCopyApi(ctx).save('x.md', 'body'), (error) => {
    assert.equal(error.code, 'write-failed')
    assert.match(error.message, /disk full/)
    return true
  })
})
