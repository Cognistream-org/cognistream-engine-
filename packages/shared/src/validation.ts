import { z } from 'zod';

export const ValidationErrorSchema = z.object({
  error: z.object({
    code: z.literal('VALIDATION_ERROR'),
    message: z.string(),
    requestId: z.string(),
    details: z
      .array(
        z.object({
          path: z.string(),
          message: z.string(),
        }),
      )
      .optional(),
  }),
});

export function formatZodError(
  error: z.ZodError,
  requestId: string,
): {
  error: {
    code: 'VALIDATION_ERROR';
    message: string;
    requestId: string;
    details: Array<{ path: string; message: string }>;
  };
} {
  return {
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      requestId,
      details: error.issues.map((issue) => ({
        path: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
    },
  };
}
