import type { z } from 'zod';

/** First error message per top-level field, for display under inputs. */
export function fieldErrors<T extends z.ZodTypeAny>(
  schema: T,
  values: unknown,
): { data?: z.infer<T>; errors: Record<string, string> } {
  const result = schema.safeParse(values);
  if (result.success) return { data: result.data, errors: {} };
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? '_');
    if (!errors[key]) errors[key] = issue.message;
  }
  return { errors };
}
