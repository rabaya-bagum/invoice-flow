import { useCallback, useRef, useState } from 'react';
import { classifyError, friendlyMessage, type ErrorKind } from '../utils/errors';

/** Runs an async action with loading + friendly-error state and blocks double submits. */
export function useSubmit() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<ErrorKind | null>(null);
  const busy = useRef(false);

  const run = useCallback(async <T>(action: () => Promise<T>): Promise<T | undefined> => {
    if (busy.current) return undefined;
    busy.current = true;
    setLoading(true);
    setError(null);
    setKind(null);
    try {
      return await action();
    } catch (err) {
      setError(friendlyMessage(err));
      setKind(classifyError(err));
      return undefined;
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);

  return { run, loading, error, kind };
}
