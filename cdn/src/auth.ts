import type { Env } from "./kv";

/**
 * `timingSafeEqual` is a Cloudflare extension to the standard Web Crypto API,
 * so it is absent from the DOM SubtleCrypto type this file is compiled
 * against. The cast is the shim; the runtime call is real.
 * https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
 */
type SubtleCryptoWithTimingSafeEqual = SubtleCrypto & {
  timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean;
};

/**
 * Compares two secrets without leaking their contents through response timing.
 * A plain `===` returns as soon as it hits the first differing byte, so an
 * attacker can measure how long a guess survived and recover the token one
 * byte at a time.
 */
function secretsMatch(provided: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(provided);
  const right = encoder.encode(expected);
  // timingSafeEqual throws on length mismatch, so length has to be checked
  // first. Length is not the secret being protected here; the token is.
  if (left.byteLength !== right.byteLength) return false;
  const subtle = crypto.subtle as SubtleCryptoWithTimingSafeEqual;
  return subtle.timingSafeEqual(left, right);
}

const BEARER_PREFIX = "Bearer ";

/** True only for a request carrying the exact shared publish token. */
export function isAuthorized(request: Request, env: Env): boolean {
  const expected = env.PUBLISH_TOKEN;
  // No configured token means the Worker was deployed without its secret.
  // Refusing every write is the safe reading of that state.
  if (!expected) return false;

  const header = request.headers.get("authorization");
  if (!header || !header.startsWith(BEARER_PREFIX)) return false;

  return secretsMatch(header.slice(BEARER_PREFIX.length), expected);
}
