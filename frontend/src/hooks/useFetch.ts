import { useState, useEffect, useCallback, useRef } from 'react';

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  lastUpdated: Date | null;
}

interface FetchOptions {
  refreshInterval?: number; // ms, 0 = disabled
}

export function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[] = [], options: FetchOptions = {}): FetchState<T> {
  const { refreshInterval = 0 } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [tick, setTick] = useState(0);
  const isFirstLoad = useRef(true);

  const refetch = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    // Only show full loading spinner on first load; subsequent polls are silent
    if (isFirstLoad.current) setLoading(true);
    setError(null);
    fetcher()
      .then(d => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
          setLastUpdated(new Date());
          isFirstLoad.current = false;
        }
      })
      .catch(e => {
        if (!cancelled) { setError(e.message); setLoading(false); }
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);

  useEffect(() => {
    if (!refreshInterval) return;
    const id = setInterval(() => setTick(t => t + 1), refreshInterval);
    return () => clearInterval(id);
  }, [refreshInterval]);

  return { data, loading, error, refetch, lastUpdated };
}
