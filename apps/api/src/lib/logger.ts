import pino, { type Logger, type LoggerOptions } from 'pino';

export function createLogger(options: {
  level: string;
  isProduction: boolean;
}): Logger {
  const loggerOptions: LoggerOptions = {
    level: options.level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'password',
        'apiKey',
        'secret',
        'token',
      ],
      censor: '[REDACTED]',
    },
  };

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
