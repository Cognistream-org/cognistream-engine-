import {
  context,
  propagation,
  trace,
  SpanStatusCode,
  type Context,
  type Span,
  type SpanOptions,
  type Tracer,
} from '@opentelemetry/api';

const TRACER_NAME = 'cognistream-api';

export function getTracer(): Tracer {
  return trace.getTracer(TRACER_NAME);
}

export type SpanAttributes = Record<string, string | number | boolean | undefined>;

/**
 * Run `fn` inside a named span. Errors are recorded and rethrown.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: SpanAttributes,
  options?: SpanOptions,
): Promise<T> {
  return getTracer().startActiveSpan(name, options ?? {}, async (span) => {
    if (attributes) {
      for (const [key, value] of Object.entries(attributes)) {
        if (value !== undefined) {
          span.setAttribute(key, value);
        }
      }
    }

    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'unknown error',
      });
      if (error instanceof Error) {
        span.recordException(error);
      }
      throw error;
    } finally {
      span.end();
    }
  });
}

export function getActiveTraceIds(): { traceId?: string; spanId?: string } {
  const span = trace.getSpan(context.active());
  if (!span) {
    return {};
  }
  const spanContext = span.spanContext();
  if (!spanContext.traceId || spanContext.traceId === '00000000000000000000000000000000') {
    return {};
  }
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
  };
}

/** Capture the current context for later restoration (async jobs / webhooks). */
export function captureContext(): Context {
  return context.active();
}

/** Run work under a previously captured context (propagates trace across async boundaries). */
export async function withCapturedContext<T>(
  ctx: Context,
  fn: () => Promise<T>,
): Promise<T> {
  return context.with(ctx, fn);
}

/** Inject W3C traceparent headers for outbound webhook callbacks. */
export function injectTraceHeaders(headers: Record<string, string> = {}): Record<string, string> {
  propagation.inject(context.active(), headers);
  return headers;
}

/** Extract inbound trace context (e.g. from webhook callbacks or job payloads). */
export function extractTraceContext(carrier: Record<string, string | string[] | undefined>): Context {
  return propagation.extract(context.active(), carrier);
}
