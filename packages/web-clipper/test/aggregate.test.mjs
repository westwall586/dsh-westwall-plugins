import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const rootPatch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
const rootPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const feedPatch = readFileSync(join(root, 'packages/feed-ultra/cordis.patch.yml'), 'utf8')

test('the generated root patch inserts the clipper exactly once', () => {
  assert.equal((rootPatch.match(/-\s+id: dsh-web-clipper\b/g) ?? []).length, 1)
})

test('the root dependencies pin the clipper once', () => {
  assert.equal(rootPackage.dependencies['@westwall/dsh-web-clipper'], '0.1.0')
  const names = Object.keys(rootPackage.dependencies)
  assert.equal(names.filter((name) => name === '@westwall/dsh-web-clipper').length, 1)
})

test('feed-ultra ships both rows in its own patch', () => {
  assert.match(feedPatch, /id: dsh-feed-ultra/)
  assert.match(feedPatch, /id: dsh-web-clipper/)
  assert.equal((feedPatch.match(/- insert:/g) ?? []).length, 1)
})