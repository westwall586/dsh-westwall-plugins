import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'

const {
  DEFAULT_FOLDER_NAME,
  defaultDirectory,
  openDirectory,
  resolveDirectory,
  safeFileName,
  saveCopy,
} = await import('../src/copy.ts')

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'dwc-copy-test-'))
}

test('the default folder is a named folder under the system temp directory', () => {
  assert.equal(defaultDirectory(), join(tmpdir(), DEFAULT_FOLDER_NAME))
  assert.deepEqual(resolveDirectory(''), {
    ok: true,
    configured: '',
    resolved: join(tmpdir(), DEFAULT_FOLDER_NAME),
    isDefault: true,
  })
})

test('a custom folder is normalized and ~ expands without a shell', () => {
  const view = resolveDirectory('~/clips')
  assert.equal(view.ok, true)
  if (view.ok) {
    assert.equal(view.resolved, join(homedir(), 'clips'))
    assert.equal(view.isDefault, false)
    assert.equal(view.configured, '~/clips')
  }
  assert.equal(resolveDirectory('clips').ok, false)
})

test('safeFileName keeps one supported extension and removes path syntax', () => {
  assert.equal(safeFileName('2026-11-14_12-30-00_Title.md'), '2026-11-14_12-30-00_Title.md')
  assert.equal(safeFileName('../../etc/passwd.md'), 'passwd.md')
  assert.equal(safeFileName('a:b*?.md'), 'a b.md')
  assert.equal(safeFileName('page.html'), 'page.html')
  assert.equal(safeFileName('page.txt'), 'page.txt.md')
  assert.equal(safeFileName('CON.md'), '_CON.md')
  assert.equal(safeFileName(''), 'clip.md')
})

test('saveCopy writes content, creates the folder, and never overwrites', async () => {
  const root = await tempDir()
  try {
    const folder = join(root, 'nested', 'clips')
    const first = await saveCopy(folder, '2026-11-14_12-30-00_T.md', 'one')
    assert.equal(first.ok, true)
    if (!first.ok) return
    assert.equal(await readFile(first.path, 'utf8'), 'one')
    assert.equal(first.directory, folder)

    const second = await saveCopy(folder, '2026-11-14_12-30-00_T.md', 'two')
    assert.equal(second.ok, true)
    if (!second.ok) return
    assert.equal(second.path, join(folder, '2026-11-14_12-30-00_T (2).md'))
    assert.equal(await readFile(first.path, 'utf8'), 'one')
    assert.equal(await readFile(second.path, 'utf8'), 'two')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('saveCopy reports a file where the folder should be', async () => {
  const root = await tempDir()
  try {
    const file = join(root, 'not-a-folder')
    await writeFile(file, 'x', 'utf8')
    const result = await saveCopy(file, 'T.md', 'body')
    assert.equal(result.ok, false)
    assert.equal(result.code, 'invalid-directory')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('openDirectory creates the folder and uses the platform opener', async () => {
  const root = await tempDir()
  try {
    const folder = join(root, 'clips')
    let call
    const fakeSpawn = (command, args, options) => {
      call = { command, args, options }
      const child = new EventEmitter()
      child.unref = () => {}
      queueMicrotask(() => child.emit('spawn'))
      return child
    }
    const result = await openDirectory(folder, { platform: 'darwin', spawn: fakeSpawn })
    assert.equal(result.ok, true)
    assert.equal(call.command, 'open')
    assert.deepEqual(call.args, [folder])
    assert.equal(call.options.detached, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('openDirectory maps Windows and Linux commands', async () => {
  for (const [platform, command] of [['win32', 'explorer.exe'], ['linux', 'xdg-open']]) {
    const root = await tempDir()
    try {
      let called
      const fakeSpawn = (name) => {
        called = name
        const child = new EventEmitter()
        child.unref = () => {}
        queueMicrotask(() => child.emit('spawn'))
        return child
      }
      const result = await openDirectory(root, { platform, spawn: fakeSpawn })
      assert.equal(result.ok, true)
      assert.equal(called, command)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
})
