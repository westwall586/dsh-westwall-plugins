/**
 * Client access to the Host copy service.
 *
 * The Host method only writes a plain file and opens its folder; the
 * conversation attachment still goes through the normal draft pipeline. The
 * remote is mounted lazily so a missing Host feature never blocks clipping.
 */

const PACKAGE_ID = 'dsh-web-clipper'
const JSON_CODEC = {
  mode: 'strict',
  typeSymbol: 'json',
  create: () => ({ parse: (value) => value }),
}
const PARAM = (name) => ({ name, wire: name, source: 'json', codec: JSON_CODEC })

export const DESCRIPTORS = [
  {
    version: 1,
    id: 'dsh-web-clipper/webClipper.directory',
    service: 'webClipper',
    namespace: 'webClipper',
    method: 'directory',
    invocation: { kind: 'direct' },
    parameters: [],
    result: JSON_CODEC,
  },
  {
    version: 1,
    id: 'dsh-web-clipper/webClipper.saveCopy',
    service: 'webClipper',
    namespace: 'webClipper',
    method: 'saveCopy',
    invocation: { kind: 'direct' },
    parameters: [PARAM('name'), PARAM('content')],
    result: JSON_CODEC,
  },
  {
    version: 1,
    id: 'dsh-web-clipper/webClipper.openDirectory',
    service: 'webClipper',
    namespace: 'webClipper',
    method: 'openDirectory',
    invocation: { kind: 'direct' },
    parameters: [],
    result: JSON_CODEC,
  },
]

export const CLIENT_CONTRIBUTION = { package: PACKAGE_ID, descriptors: DESCRIPTORS }

function unwrap(result, what) {
  if (result?.ok === true) return result.value
  const error = new Error(`${what}: ${result?.error?.message || 'unknown error'}`)
  error.code = result?.error?.code
  throw error
}

/** Wait for the generated namespace that appears after `$mount`. */
function mountNamespace(ctx, name, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} did not mount`)), timeoutMs)
    try {
      ctx.inject([name], (remoteCtx) => {
        clearTimeout(timer)
        const value = name.split('.').reduce((node, key) => (node ? node[key] : undefined), remoteCtx)
        resolve(value ?? null)
        return () => {}
      })
    } catch (error) {
      clearTimeout(timer)
      reject(error)
    }
  })
}

/**
 * @param ctx - client context with the `remote` service.
 * @returns `{ save, directory, open }` value-level methods.
 */
export function createCopyApi(ctx) {
  let pending
  const namespace = () => {
    if (pending === undefined) {
      const attempt = ctx.remote.$mount(CLIENT_CONTRIBUTION)
        .then(() => mountNamespace(ctx, 'remote.webClipper'))
        .then((value) => {
          if (value === null || value === undefined) throw new Error('webClipper remote did not mount')
          return value
        })
      pending = attempt
      void attempt.catch(() => {
        if (pending === attempt) pending = undefined
      })
    }
    return pending
  }

  const call = async (method, args, what) => {
    const remote = await namespace()
    return unwrap(await remote[method](...args), what)
  }

  return {
    save: (name, content) => call('saveCopy', [name, content], 'webClipper.saveCopy'),
    directory: () => call('directory', [], 'webClipper.directory'),
    open: () => call('openDirectory', [], 'webClipper.openDirectory'),
  }
}
