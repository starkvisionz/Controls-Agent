"use client";

import { useCallback, useEffect, useState } from "react";

type State<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
};

type Settled<T> = { key: string; data: T | null; error: string | null };

/**
 * Minimal fetch-on-mount hook. Views are read-mostly and each one loads a
 * single composite payload, so a full data library would be more machinery
 * than the app needs.
 *
 * State is written only from the fetch callbacks, never synchronously in the
 * effect body — a synchronous `setLoading(true)` there costs a second render
 * pass on every url change. `loading` is instead derived by comparing the
 * request we want against the one that has settled, which also makes a stale
 * response impossible to display: a settled result counts only when its key
 * matches the request currently in force.
 */
export function useResource<T>(url: string | null): State<T> {
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const [nonce, setNonce] = useState(0);

  const key = url ? `${nonce}:${url}` : null;

  useEffect(() => {
    if (!key || !url) return;

    const controller = new AbortController();

    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
        return res.json();
      })
      .then((json) => setSettled({ key, data: json as T, error: null }))
      .catch((err: unknown) => {
        // An aborted request was superseded or unmounted; it has no result to
        // report and its key is no longer current either way.
        if (controller.signal.aborted) return;
        setSettled({
          key,
          data: null,
          error: err instanceof Error ? err.message : "Request failed",
        });
      });

    return () => controller.abort();
  }, [key, url]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // Only a result belonging to the request currently in force may be shown.
  const current = settled && settled.key === key ? settled : null;

  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: key !== null && current === null,
    reload,
  };
}
