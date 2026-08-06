// Server-clock seam. All timestamps come from this module, never from the
// client, and tests can pin the clock through index.js's __test helpers.
let clock = () => Date.now();

export function setClockForTesting(nextClock) {
  if (typeof nextClock !== "function") throw new TypeError("clock must be a function");
  clock = nextClock;
}

export function resetClock() {
  clock = () => Date.now();
}

export function nowMs() {
  return clock();
}

export function nowSec() {
  return Math.floor(clock() / 1000);
}
