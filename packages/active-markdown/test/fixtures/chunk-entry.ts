/** Fixture entry: load a chunk through the bundle wrapper's loader handle. */
import { loadChunk } from '../../client/src/chunks.ts'

export default {
  async answer(): Promise<unknown> {
    const exports = await loadChunk('client.demo.js')
    return exports.answer
  },
}
