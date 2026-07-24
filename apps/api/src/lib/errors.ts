export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number,
    public requestId: string,
    public details?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export type ErrorBody = {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: Array<{ path: string; message: string }>;
  };
};

export function errorBody(
  code: string,
  message: string,
  requestId: string,
  details?: Array<{ path: string; message: string }>,
): ErrorBody {
  return {
    error: {
      code,
      message,
      requestId,
      ...(details ? { details } : {}),
    },
  };
}
