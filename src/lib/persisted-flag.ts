"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Values that survive a reload, read through `useSyncExternalStore`.
 *
 * The obvious implementation — default state, then restore from localStorage in
 * an effect — costs a second render on every mount and is exactly the
 * cascading-render pattern React now warns about. Reading it in a `useState`
 * initialiser is worse: the server renders the default and the client renders
 * the stored value, which is a hydration mismatch.
 *
 * `useSyncExternalStore` is built for this. `getServerSnapshot` supplies the
 * default during SSR so the markup matches, and React swaps in the real value
 * after hydration without either problem.
 */

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Also follow changes made in another tab.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

// ---------------------------------------------------------------------------
// Storage, with a fallback for when there isn't any
// ---------------------------------------------------------------------------

/**
 * Values whose write to localStorage threw, held for the life of the page.
 *
 * Swallowing a blocked write and then reading straight back from storage
 * returns the old value — or none — so the setting never changes and the
 * control it drives does nothing at all. "Not remembered after a reload" is an
 * acceptable degradation; "does not work" is not, and blocked site data is a
 * browser setting rather than an exotic failure.
 *
 * Only keys that actually failed to store are held here, so a working browser
 * keeps reading from localStorage and still sees changes made in another tab.
 */
const unstored = new Map<string, string>();

function readRaw(key: string): string | null {
  if (unstored.has(key)) return unstored.get(key) ?? null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Reads can throw too when site data is blocked outright.
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
    // A previously blocked key that now stores should go back to being read
    // from storage, so another tab's changes reach this one again.
    unstored.delete(key);
  } catch {
    // Blocked or full. Keep it in memory so the value the caller just set is
    // the value the next read returns.
    unstored.set(key, value);
  }
  // localStorage does not raise `storage` in the tab that wrote it.
  notify();
}

// ---------------------------------------------------------------------------

export function usePersistedFlag(
  key: string,
  fallback: boolean
): [boolean, (next: boolean | ((current: boolean) => boolean)) => void] {
  const read = useCallback(() => {
    const raw = readRaw(key);
    return raw === null ? fallback : raw === "true";
  }, [key, fallback]);

  const getServerSnapshot = useCallback(() => fallback, [fallback]);
  const value = useSyncExternalStore(subscribe, read, getServerSnapshot);

  const set = useCallback(
    (next: boolean | ((current: boolean) => boolean)) => {
      const current = readRaw(key);
      const resolved =
        typeof next === "function" ? next(current === null ? fallback : current === "true") : next;
      writeRaw(key, String(resolved));
    },
    [key, fallback]
  );

  return [value, set];
}

/**
 * The string equivalent, for a remembered selection rather than a toggle.
 *
 * Returns null on the server and until hydration, which is what lets the caller
 * fall back to a default without the markup disagreeing with itself.
 */
export function usePersistedString(key: string): [string | null, (next: string) => void] {
  const read = useCallback(() => readRaw(key), [key]);
  const getServerSnapshot = useCallback(() => null, []);

  const value = useSyncExternalStore(subscribe, read, getServerSnapshot);
  const set = useCallback((next: string) => writeRaw(key, next), [key]);

  return [value, set];
}
