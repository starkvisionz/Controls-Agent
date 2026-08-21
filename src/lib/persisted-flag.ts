"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A boolean that survives a reload, read through `useSyncExternalStore`.
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

function read(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : raw === "true";
  } catch {
    // Private browsing or blocked site data — the value simply does not persist.
    return fallback;
  }
}

function write(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Non-fatal: the setting applies for this session and is not remembered.
  }
  // localStorage does not raise `storage` in the tab that wrote it.
  notify();
}

export function usePersistedFlag(
  key: string,
  fallback: boolean
): [boolean, (next: boolean | ((current: boolean) => boolean)) => void] {
  const getSnapshot = useCallback(() => read(key, fallback), [key, fallback]);
  const getServerSnapshot = useCallback(() => fallback, [fallback]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const set = useCallback(
    (next: boolean | ((current: boolean) => boolean)) => {
      write(key, typeof next === "function" ? next(read(key, fallback)) : next);
    },
    [key, fallback]
  );

  return [value, set];
}
