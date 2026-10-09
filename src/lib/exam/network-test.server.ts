/** Shared helpers for the /api/network-test/* endpoints. */

/** Upper bound for a single download/upload sample, to stop the endpoints being abused. */
export const MAX_TEST_BYTES = 16 * 1024 * 1024;

export const NO_STORE = {
  "cache-control": "no-store, no-cache, must-revalidate",
  pragma: "no-cache",
};

export function randomChunk(size: number): Uint8Array {
  const buf = new Uint8Array(size);
  // getRandomValues is limited to 65,536 bytes per call.
  for (let offset = 0; offset < size; offset += 65536) {
    crypto.getRandomValues(buf.subarray(offset, Math.min(offset + 65536, size)));
  }
  return buf;
}
