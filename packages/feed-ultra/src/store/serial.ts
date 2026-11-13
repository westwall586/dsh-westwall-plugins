/** One in-process queue per key; a failed task does not poison the next one. */
export interface SerialGate {
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
}

/**
 * The shared mutable state is one day cache file, so callers key the gate by the
 * day, not by the source. The gate is taken once at the service entry point;
 * nothing below it may re-enter it.
 */
export function createSerialGate(): SerialGate {
  const inflight = new Map<string, Promise<unknown>>();

  async function run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = inflight.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    inflight.set(key, current);
    try {
      return await current;
    } finally {
      if (inflight.get(key) === current) inflight.delete(key);
    }
  }

  return { run };
}
