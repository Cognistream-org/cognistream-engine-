export type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
    details?: Array<{ path: string; message: string }>;
  };
};

export class CogniStreamError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly requestId?: string;
  readonly details?: Array<{ path: string; message: string }>;

  constructor(
    message: string,
    options: {
      code: string;
      statusCode: number;
      requestId?: string;
      details?: Array<{ path: string; message: string }>;
    },
  ) {
    super(message);
    this.name = 'CogniStreamError';
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.requestId = options.requestId;
    this.details = options.details;
  }
}

export class CogniStreamAuthError extends CogniStreamError {
  constructor(message = 'Unauthorized', requestId?: string) {
    super(message, { code: 'UNAUTHORIZED', statusCode: 401, requestId });
    this.name = 'CogniStreamAuthError';
  }
}

export class CogniStreamValidationError extends CogniStreamError {
  constructor(
    message = 'Validation failed',
    requestId?: string,
    details?: Array<{ path: string; message: string }>,
  ) {
    super(message, {
      code: 'VALIDATION_ERROR',
      statusCode: 422,
      requestId,
      details,
    });
    this.name = 'CogniStreamValidationError';
  }
}

export class CogniStreamRateLimitError extends CogniStreamError {
  readonly retryAfter: number;

  constructor(message = 'Rate limit exceeded', retryAfter = 60, requestId?: string) {
    super(message, { code: 'RATE_LIMITED', statusCode: 429, requestId });
    this.name = 'CogniStreamRateLimitError';
    this.retryAfter = retryAfter;
  }
}

export function mapAxiosError(error: unknown): never {
  if (
    typeof error === 'object' &&
    error !== null &&
    'isAxiosError' in error &&
    (error as { isAxiosError?: boolean }).isAxiosError
  ) {
    const ax = error as unknown as {
      response?: {
        status?: number;
        data?: ApiErrorBody;
        headers?: Record<string, string>;
      };
      message: string;
    };
    const status = ax.response?.status ?? 500;
    const body = ax.response?.data?.error;
    const requestId = body?.requestId;
    const message = body?.message ?? ax.message;

    if (status === 401 || status === 403) {
      throw new CogniStreamAuthError(message, requestId);
    }
    if (status === 422) {
      throw new CogniStreamValidationError(message, requestId, body?.details);
    }
    if (status === 429) {
      const retryAfterHeader = ax.response?.headers?.['retry-after'];
      const retryAfter = retryAfterHeader ? Number(retryAfterHeader) || 60 : 60;
      throw new CogniStreamRateLimitError(message, retryAfter, requestId);
    }
    throw new CogniStreamError(message, {
      code: body?.code ?? 'REQUEST_ERROR',
      statusCode: status,
      requestId,
      details: body?.details,
    });
  }

  throw error instanceof Error ? error : new Error(String(error));
}
