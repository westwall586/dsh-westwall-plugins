/** 全局安装探测只读 patch 文件，命中第一个就停，找不到不抛错。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { detectGlobalInstall, patchCandidates } from '../src/global-install.ts'

async function withHome(files: Record<string, string>, run: (home: string) => Promise<void>): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), 'cg-home-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    for (const [relative, text] of Object.entries(files)) {
      const full = join(home, relative)
      await mkdir(join(full, '..'), { recursive: true })
      await writeFile(full, text)
    }
    await run(home)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
}

test('no patch files means no global install', async () => {
  await withHome({}, async () => {
    assert.deepEqual(patchCandidates(), [])
    assert.equal(await detectGlobalInstall({} as never), undefined)
  })
})

test('a home patch with a codegraph server row is reported', async () => {
  await withHome({
    'cordis.patch.yml': '- insert:\n    - id: mcp-codegraph\n      config:\n        serverName: codegraph\n',
  }, async (home) => {
    assert.deepEqual(patchCandidates(home), [join(home, 'cordis.patch.yml')])
    assert.deepEqual(await detectGlobalInstall({} as never), { file: join(home, 'cordis.patch.yml') })
  })
})

test('a profile patch counts too, and quoted or inline rows are recognized', async () => {
  await withHome({
    'profiles/web/cordis.patch.yml': '[]\n- config: { serverName: "codegraph" }\n',
  }, async (home) => {
    assert.deepEqual(patchCandidates(home), [join(home, 'profiles/web/cordis.patch.yml')])
    assert.deepEqual(await detectGlobalInstall({} as never), { file: join(home, 'profiles/web/cordis.patch.yml') })
  })
})

test('another server name is not a CodeGraph install', async () => {
  await withHome({
    'cordis.patch.yml': '- config:\n    serverName: codegraph-other\n',
  }, async () => {
    assert.equal(await detectGlobalInstall({} as never), undefined)
  })
})
