/** Bundle the browser program into client.js plus the package-local chunks it loads on demand. */
import { writeFile } from 'node:fs/promises'
import { assertLimit, bundleModule, CHUNK_LIMIT, ENTRY_LIMIT, wrapChunk, wrapEntry } from './client-bundle.mjs'

const root = new URL('../', import.meta.url)

const ENTRY = { entryPoint: 'client/src/main.tsx', globalName: 'DshActiveMarkdownClient', fileName: 'client.js' }

/**
 * Chunks the entry loads through `__dshRequire.async` instead of carrying them in `client.js`.
 * Each file name must match the loader's `client.<name>.js` form, and its module must
 * default-export the API that `client/src/chunks.ts` hands back.
 */
const CHUNKS = [
  {
    entryPoint: 'client/src/rich/mermaid/chunk.tsx',
    globalName: 'DshActiveMarkdownMermaid',
    fileName: 'client.mermaid.js',
  },
  {
    entryPoint: 'client/src/rich/markmap/chunk.tsx',
    globalName: 'DshActiveMarkdownMarkmap',
    fileName: 'client.markmap.js',
  },
  {
    entryPoint: 'client/src/rich/math/chunk.tsx',
    globalName: 'DshActiveMarkdownMath',
    fileName: 'client.math.js',
  },
]

/**
 * Bundle one program, guard its size, and write it beside this plugin.
 * @param program - entry point, IIFE global, and output file name.
 * @param limit - size ceiling of the artifact.
 * @param wrap - loader wrapper for this artifact kind.
 */
async function emit(program, limit, wrap) {
  const text = wrap(await bundleModule(program.entryPoint, program.globalName))
  assertLimit(program.fileName, text, limit)
  await writeFile(new URL(program.fileName, root), text)
  const bytes = Buffer.byteLength(text)
  console.log(`built ${program.fileName} (${bytes} bytes, ${(bytes / 1024).toFixed(0)}KB)`)
}

await emit(ENTRY, ENTRY_LIMIT, text => wrapEntry(text, ENTRY.globalName))
for (const chunk of CHUNKS) {
  await emit(chunk, CHUNK_LIMIT, text => wrapChunk(text, chunk.globalName, chunk.fileName))
}
