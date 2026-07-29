import { AppError } from '../lib/errors.js';
import { setGauge } from './metrics.js';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export type CircuitBreakerOptions = {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  halfOpenMaxCalls?: number;
  /** Injectable clock for tests. */
  now?: () => number;
};

const DEFAULTS = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenMaxCalls: 3,
} as const;

const STATE_VALUE: Record<CircuitState, number> = {
  CLOSED: 0,
  OPEN: 1,
  HALF_OPEN: 2,
};

export class CircuitOpenError extends AppError {
  constructor(service: string, requestId = 'unknown') {
    super(
      'SERVICE_UNAVAILABLE',
      `Circuit breaker open for service: ${service}`,
      503,
      requestId,
    );
    this.name = 'CircuitOpenError';
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private openedAt = 0;
  private halfOpenInFlight = 0;
  private halfOpenSuccesses = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenMaxCalls: number;
  private readonly now: () => number;

  constructor(
    private readonly service: string,
    options: CircuitBreakerOptions = {},
  ) {
    this.failureThreshold = options.failureThreshold ?? DEFAULTS.failureThreshold;
    this.resetTimeoutMs = options.resetTimeoutMs ?? DEFAULTS.resetTimeoutMs;
    this.halfOpenMaxCalls = options.halfOpenMaxCalls ?? DEFAULTS.halfOpenMaxCalls;
    this.now = options.now ?? Date.now;
    this.publishMetric();
  }

  getState(): CircuitState {
    this.maybeTransitionToHalfOpen();
    return this.state;
  }

  async execute<T>(fn: () => Promise<T>, requestId = 'unknown'): Promise<T> {
    this.maybeTransitionToHalfOpen();

    if (this.state === 'OPEN') {
      throw new CircuitOpenError(this.service, requestId);
    }

    if (this.state === 'HALF_OPEN') {
      if (this.halfOpenInFlight >= this.halfOpenMaxCalls) {
        throw new CircuitOpenError(this.service, requestId);
      }
      this.halfOpenInFlight += 1;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    } finally {
      if (this.state === 'HALF_OPEN' || this.halfOpenInFlight > 0) {
        this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1);
      }
    }
  }

  /** Test helper */
  forceOpen(): void {
    this.state = 'OPEN';
    this.openedAt = this.now();
    this.publishMetric();
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.halfOpenSuccesses += 1;
      if (this.halfOpenSuccesses >= this.halfOpenMaxCalls) {
        this.state = 'CLOSED';
        this.failures = 0;
        this.halfOpenSuccesses = 0;
        this.publishMetric();
      }
      return;
    }
    this.failures = 0;
  }

  private onFailure(): void {
    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this.openedAt = this.now();
      this.halfOpenSuccesses = 0;
      this.publishMetric();
      return;
    }

    this.failures += 1;
    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
      this.openedAt = this.now();
      this.publishMetric();
    }
  }

  private maybeTransitionToHalfOpen(): void {
    if (this.state !== 'OPEN') return;
    if (this.now() - this.openedAt >= this.resetTimeoutMs) {
      this.state = 'HALF_OPEN';
      this.halfOpenInFlight = 0;
      this.halfOpenSuccesses = 0;
      this.publishMetric();
    }
  }

  private publishMetric(): void {
    setGauge('circuit_breaker_state', STATE_VALUE[this.state], {
      service: this.service,
    });
  }
}

const breakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(
  service: string,
  options?: CircuitBreakerOptions,
): CircuitBreaker {
  let breaker = breakers.get(service);
  if (!breaker) {
    breaker = new CircuitBreaker(service, options);
    breakers.set(service, breaker);
  }
  return breaker;
}

export function resetCircuitBreakers(): void {
  breakers.clear();
}
