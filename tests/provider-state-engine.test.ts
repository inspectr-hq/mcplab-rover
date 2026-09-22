import { describe, expect, it } from 'vitest';
import {
  ProviderStateEngine,
  type ProviderObservation
} from '../src/runtime/provider-state-engine';

function observation(
  at: number,
  options: Partial<ProviderObservation> = {}
): ProviderObservation {
  return {
    observedAt: at,
    response: null,
    signals: {},
    ...options
  };
}

describe('ProviderStateEngine', () => {
  it('keeps a submitted request waiting until a response is associated with it', () => {
    const engine = new ProviderStateEngine({
      quietPeriodMs: 20,
      minResponseAgeMs: 0,
      timeoutMs: 1_000,
      requireGenerationSignal: false
    }, 0);

    expect(engine.markSubmitted(0).state).toBe('submitted');
    expect(engine.update(observation(10)).state).toBe('waiting');
    expect(
      engine.update(
        observation(20, {
          response: { identity: 'turn-1', text: 'answer', belongsToRequest: true },
          signals: { idle_visible: true }
        })
      ).state
    ).toBe('generating');
  });

  it('keeps response activity active until the quiet period expires', () => {
    const engine = new ProviderStateEngine({
      quietPeriodMs: 20,
      minResponseAgeMs: 0,
      timeoutMs: 1_000,
      requireGenerationSignal: false
    }, 0);
    engine.markSubmitted(0);

    expect(
      engine.update(
        observation(10, {
          response: { identity: 'turn-1', text: 'partial', belongsToRequest: true },
          signals: { idle_visible: true }
        })
      ).signals.response_mutating
    ).toBe(true);
    expect(
      engine.update(
        observation(25, {
          response: { identity: 'turn-1', text: 'partial answer', belongsToRequest: true },
          signals: { idle_visible: true }
        })
      ).signals.response_mutating
    ).toBe(true);
    expect(
      engine.update(
        observation(45, {
          response: { identity: 'turn-1', text: 'partial answer', belongsToRequest: true },
          signals: { idle_visible: true }
        })
      ).state
    ).toBe('finished');
  });

  it('uses unknown only when a response exists without safe readiness evidence', () => {
    const engine = new ProviderStateEngine({
      quietPeriodMs: 0,
      minResponseAgeMs: 0,
      timeoutMs: 1_000,
      requireGenerationSignal: false
    }, 0);
    engine.markSubmitted(0);

    expect(
      engine.update(
        observation(10, {
          response: { identity: 'turn-1', text: 'answer', belongsToRequest: true }
        })
      ).state
    ).toBe('unknown');
    expect(engine.update(observation(20)).state).toBe('waiting');
  });

  it('keeps finished terminal when a later observation reports activity', () => {
    const engine = new ProviderStateEngine({
      quietPeriodMs: 0,
      minResponseAgeMs: 0,
      timeoutMs: 1_000,
      requireGenerationSignal: false
    }, 0);
    engine.markSubmitted(0);
    const finished = engine.update(
      observation(10, {
        response: { identity: 'turn-1', text: 'answer', belongsToRequest: true },
        signals: { idle_visible: true }
      })
    );

    const later = engine.update(
      observation(20, {
        response: { identity: 'turn-1', text: 'answer continued', belongsToRequest: true },
        signals: { generation_active: true }
      })
    );

    expect(finished.state).toBe('finished');
    expect(later.state).toBe('finished');
    expect(later.terminal).toBe(true);
    expect(later.history.at(-1)?.anomaly).toBe('post-terminal-observation');
  });

  it('requires a response associated with the current request before finishing', () => {
    const engine = new ProviderStateEngine({
      quietPeriodMs: 0,
      minResponseAgeMs: 0,
      timeoutMs: 1_000,
      requireGenerationSignal: false
    }, 0);
    engine.markSubmitted(0);

    expect(
      engine.update(
        observation(10, {
          response: { identity: 'old-turn', text: 'old answer', belongsToRequest: false },
          signals: { idle_visible: true }
        })
      ).state
    ).toBe('waiting');
  });

  it('enforces a configured minimum state duration', () => {
    const engine = new ProviderStateEngine({
      quietPeriodMs: 0,
      minResponseAgeMs: 0,
      timeoutMs: 1_000,
      requireGenerationSignal: false,
      minimumStateDurationMs: { submitted: 20 }
    }, 0);
    engine.markSubmitted(0);

    expect(
      engine.update(
        observation(10, {
          response: { identity: 'turn-1', text: 'partial', belongsToRequest: true },
          signals: { generation_active: true }
        })
      ).state
    ).toBe('submitted');
    expect(
      engine.update(
        observation(20, {
          response: { identity: 'turn-1', text: 'partial', belongsToRequest: true },
          signals: { generation_active: true }
        })
      ).state
    ).toBe('generating');
  });
});
