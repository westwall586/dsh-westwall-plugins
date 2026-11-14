import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
const zh = JSON.parse(readFileSync(join(root, 'locale/zh.json'), 'utf8'))
const en = JSON.parse(readFileSync(join(root, 'locale/en.json'), 'utf8'))

test('package identity and bundle patch', () => {
  assert.equal(pkg.name, '@westwall/dsh-web-clipper')
  assert.equal(pkg.version, '0.1.0')
  assert.equal(pkg.private, true)
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.deepEqual(pkg.dsh.engines, { dsh: '>=0.2.2-rc.2' })
  assert.match(patch, /-\s+id: dsh-web-clipper\n\s+name: '@westwall\/dsh-web-clipper'/)
  assert.equal((patch.match(/- insert:/g) ?? []).length, 1)
})

test('the client half declares platform, immediacy, and the sidebar inject', () => {
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.dsh.client.immediately, true)
  assert.deepEqual(pkg.dsh.client.inject, ['@deepseek-ai/dsh-client-ui-sidebar-right'])
})

test('exports and files cover both entries plus the assets', () => {
  assert.equal(pkg.exports['.'], './src/index.ts')
  assert.equal(pkg.exports['./client'], './client.js')
  assert.equal(pkg.exports['./icon'], './icon.svg')
  for (const entry of ['src', 'client', 'client.js', 'tools', 'cordis.patch.yml', 'locale', 'icon.svg', 'README.md', 'docs']) {
    assert.ok(pkg.files.includes(entry), `files is missing ${entry}`)
  }
  assert.equal(pkg.scripts.test, "node tools/build.mjs && node --test 'test/**/*.test.mjs'")
})

test('locale meta and every user-facing error key exist in both languages', () => {
  for (const dictionary of [zh, en]) {
    assert.ok(dictionary.meta.title.length > 0)
    assert.ok(dictionary.meta.description.length > 0)
    for (const key of [
      'tabMenu.label', 'tabMenu.loading', 'composer.label', 'composer.loading',
      'toast.region', 'toast.success',
      'error.desktop-only', 'error.no-page', 'error.page-loading', 'error.busy',
      'error.capture-timeout', 'error.capture-failed', 'error.extract-failed',
      'error.composer-busy', 'error.attach-failed', 'toast.copyFailed',
      'settings.copyHint', 'settings.currentFolder', 'settings.folder',
      'settings.placeholder', 'settings.defaultHint', 'settings.save',
      'settings.choose', 'settings.open', 'settings.useDefault', 'settings.saved',
      'settings.saveRefused', 'settings.directoryUnavailable', 'settings.openFailed',
      'settings.opened', 'settings.loading', 'settings.unavailable', 'settings.desktopOnly',
      'settings.temporaryTag', 'detail.title', 'detail.usage', 'detail.copy', 'detail.naming',
    ]) {
      assert.equal(typeof dictionary[key], 'string', key)
      assert.ok(dictionary[key].length > 0, key)
    }
  }
  assert.equal(zh['tabMenu.label'], '添加到会话')
  assert.equal(en['tabMenu.label'], 'Add to conversation')
})

test('the host companion owns the readable copy service', () => {
  const source = readFileSync(join(root, 'src/index.ts'), 'utf8')
  assert.match(source, /class WebClipper extends TypertRemoteService/)
  assert.match(source, /async saveCopy/)
  assert.match(source, /async openDirectory/)
  assert.match(source, /outputDirectory/)
  assert.match(source, /remote-methods/)
  assert.match(source, /'saveCopy'/)
})