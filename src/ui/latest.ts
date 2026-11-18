/**
 * Applies results in request order only: a slower, older read never overwrites a newer one (KWS-033).
 * Returns a function that starts a read and applies its result if it is still the latest.
 */
export function latestOnly() {
  let seq = 0;
  return <T>(read: Promise<T>, apply: (v: T) => void, fail: (e: unknown) => void) => {
    const mine = ++seq;
    return read.then((v) => { if (mine === seq) apply(v); }, (e) => { if (mine === seq) fail(e); });
  };
}
