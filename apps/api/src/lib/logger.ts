import pino, { type Logger, type LoggerOptions } from 'pino';
import { getActiveTraceIds } from '../telemetry/tracing.js';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'password',
  'apiKey',
  'api_key',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'email',
  'emailAddress',
  'phone',
  'phoneNumber',
  'ssn',
  'cardNumber',
  '*.password',
  '*.apiKey',
  '*.secret',
  '*.token',
  '*.email',
];

export function createLogger(options: {
  level: string;
  isProduction: boolean;
  service?: string;
}): Logger {
  const service = options.service ?? 'cognistream-api';

  const loggerOptions: LoggerOptions = {
    level: options.level,
    base: {
      service,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    mixin() {
      const { traceId, spanId } = getActiveTraceIds();
      return {
        ...(traceId ? { traceId } : {}),
        ...(spanId ? { spanId } : {}),
      };
    },
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
  };

  // Pretty transport only in local/dev — production uses structured JSON.
  if (!options.isProduction) {
    loggerOptions.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    };
  }

  return pino(loggerOptions);
}

/**
 * Bind request-scoped fields so every log line includes requestId + trace context.
 */
export function bindRequestLogger(
  logger: Logger,
  fields: { requestId: string; traceId?: string; spanId?: string },
): Logger {
  return logger.child({
    requestId: fields.requestId,
    ...(fields.traceId ? { traceId: fields.traceId } : {}),
    ...(fields.spanId ? { spanId: fields.spanId } : {}),
  });
}
