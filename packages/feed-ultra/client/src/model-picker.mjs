/**
 * The two model RPCs with request sequence numbers. The settings pane stays
 * render-only: it receives this port from the panel and never imports the
 * feedUltra facade, and no React lives here.
 */

export function createModelPicker(remote) {
  let sequence = 0;
  return {
    models: () => remote.models(),
    /** `{ requestId, done }` so the caller can enter the loading state synchronously. */
    efforts(provider, model) {
      const requestId = ++sequence;
      const done = remote.modelEfforts(provider, model).then(
        result => ({ requestId, result }),
        error => ({ requestId, error }),
      );
      return { requestId, done };
    },
  };
}
