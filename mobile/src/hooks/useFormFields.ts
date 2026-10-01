import { useCallback, useState } from 'react';

/** Minimal string-field form state: values, per-field errors, and a bound setter per field. */
export function useFormFields<T extends Record<string, string>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = useCallback(
    (key: keyof T) => (value: string) => setValues((v) => ({ ...v, [key]: value })),
    [],
  );
  return { values, setValues, errors, setErrors, set };
}
