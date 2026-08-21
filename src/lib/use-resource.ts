"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type State<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
};

/**
 * Minimal fetch-on-mount hook. Views are read-mostly and each one loads a
 * single composite payload, so a full data library would be more machinery
 * than the app needs.
 */
export function useResource<T>(url: string | null): State<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [nonce, setNonce] = useState(0);

  // Ignore responses from a request that has already been superseded.
  const latest = useRef(0);

  useEffect(() => {
    if (!url) {
      setData(null);
      setLoading(false);
      return;
    }

    const request = ++latest.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
        return res.json();
      })
      .then((json) => {
        if (request === latest.current) {
          setData(json as T);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || request !== latest.current) return;
        setError(err instanceof Error ? err.message : "Request failed");
        setLoading(false);
      });

    return () => controller.abort();
  }, [url, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}
