/** Package-local dynamic chunks: one cached load per file name, retried after a failure. */

/** The loader's asynchronous chunk operation, handed in by the bundle wrapper. */
interface ChunkRequire {
  async(specifier: string): Promise<Record<string, unknown>>
}

/** Wrapper-provided loader handle; absent when the bundle runs outside the DSH module system. */
declare const __dshRequire: ChunkRequire | undefined

/** In-flight and settled loads, keyed by chunk file name. */
const loads = new Map<string, Promise<Record<string, unknown>>>()

/**
 * Load one package-local chunk and return its exports.
 * Concurrent requests share one load; a rejected load is forgotten so the next request retries.
 * @param file - chunk file name beside `client.js`, such as `client.math.js`.
 * @returns the exports of the chunk's default export.
 */
export function loadChunk(file: string): Promise<Record<string, unknown>> {
  const pending = loads.get(file)
  if (pending !== undefined) return pending
  const load = (async (): Promise<Record<string, unknown>> => {
    if (typeof __dshRequire === 'undefined') throw new Error(`active-markdown: chunk ${file} needs the DSH module loader`)
    return await __dshRequire.async(`./${file}`)
  })().catch((error: unknown) => {
    loads.delete(file)
    throw error
  })
  loads.set(file, load)
  return load
}
