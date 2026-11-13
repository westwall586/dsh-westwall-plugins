export type FeedUltraErrorCode =
  | 'unbound'
  | 'invalid-workspace'
  | 'invalid-date'
  | 'future-date'
  | 'invalid-range'
  | 'invalid-request'
  | 'invalid-input'
  | 'unknown-source'
  | 'unsupported-action';

/** Domain failure the host shell translates into a stable Remote error code. */
export class FeedUltraError extends Error {
  readonly code: FeedUltraErrorCode;

  constructor(code: FeedUltraErrorCode, message: string) {
    super(message);
    this.name = 'FeedUltraError';
    this.code = code;
  }
}
