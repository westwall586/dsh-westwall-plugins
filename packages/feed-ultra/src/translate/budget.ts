/** The price of one translate action, including any time spent waiting for the day gate. */
export const TRANSLATE_BUDGET_MS = 60_000;

export interface Budget {
  readonly signal: AbortSignal;
  readonly timedOut: boolean;
  dispose(): void;
}

/**
 * Owns one abort controller and one timer. The timer is unref'd and cleared by
 * `dispose`, so a test process is not held open by an unused budget.
 */
export function startBudget(ms: number): Budget {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  timer.unref();

  return {
    get signal() {
      return controller.signal;
    },
    get timedOut() {
      return timedOut;
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}
