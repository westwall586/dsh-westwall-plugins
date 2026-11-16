/** Local Markdown images read as bytes and shown through Blob URLs. */
import { READ_CAP, type ReadBytes } from './source.ts'

/** Images are small; one window covers any realistic diagram. */
const IMAGE_CAP = READ_CAP

/** Whether a source is already a URL the browser can load directly. */
export function isRemoteSource(src: string): boolean {
  if (/^[A-Za-z]:[\\/]/.test(src)) return false
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src) && !/^file:/i.test(src)
}

/** The decoded local path an image source names, or `undefined` for a URL. */
export function localImagePath(src: string): string | undefined {
  const clean = src.trim().split(/[?#]/)[0]
  if (clean === '' || isRemoteSource(clean)) return undefined
  try {
    return decodeURIComponent(clean)
  } catch {
    return clean
  }
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false
  return signature.every((value, index) => bytes[offset + index] === value)
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

/** The media type of a local image from its magic bytes. */
export function imageMediaType(bytes: Uint8Array): string | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif'
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp'
  if (startsWith(bytes, [0x42, 0x4d])) return 'image/bmp'
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return 'image/x-icon'
  const head = new TextDecoder().decode(bytes.subarray(0, 1024)).trimStart()
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml'
  if (head.startsWith('<!--') && head.includes('<svg')) return 'image/svg+xml'
  return undefined
}

export interface ImageResolver {
  resolve(src: string): Promise<string | undefined>
  dispose(): void
}

/**
 * Bind one tab's images to the Host byte reader.
 * @param remote - the Host byte reader.
 * @param sessionId - Session authorizing the read.
 * @param documentPath - the Markdown file that relative sources resolve from.
 * @returns a memoized resolver whose object URLs live until `dispose`.
 */
export function createImageResolver(
  read: ReadBytes,
  sessionId: string,
  documentPath: string,
): ImageResolver {
  const controller = new AbortController()
  const cache = new Map<string, Promise<string | undefined>>()
  const urls = new Set<string>()
  let disposed = false

  const load = async (src: string): Promise<string | undefined> => {
    const path = localImagePath(src)
    if (disposed || path === undefined) return undefined
    try {
      const result = await read(sessionId, path, {
        baseFile: documentPath,
        range: { offset: 0, length: IMAGE_CAP },
      }, controller.signal)
      if (disposed || !result.ok || !result.value.eof) return undefined
      const type = imageMediaType(result.value.data)
      if (type === undefined) return undefined
      const url = URL.createObjectURL(new Blob([result.value.data], { type }))
      urls.add(url)
      return url
    } catch {
      return undefined
    }
  }

  return {
    resolve(src: string): Promise<string | undefined> {
      const cached = cache.get(src)
      if (cached !== undefined) return cached
      const pending = load(src)
      cache.set(src, pending)
      return pending
    },
    dispose(): void {
      disposed = true
      controller.abort()
      for (const url of urls) URL.revokeObjectURL(url)
      urls.clear()
      cache.clear()
    },
  }
}
