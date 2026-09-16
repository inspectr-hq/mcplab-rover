import { describe, expect, it } from 'vitest';
import { registrationPayload, scenarioStatusForItem, ROVER_CAPABILITIES, ROVER_LEASE_RELEASE_REASONS } from '../src/mcplab/rover-protocol';

describe('Rover protocol', () => {
  it('maps queue item state to scenario status events', () => {
    expect(scenarioStatusForItem({ status: 'queued' })).toMatchObject({ status: 'queued', completed: 0, total: 1 });
    expect(scenarioStatusForItem({ status: 'running' })).toMatchObject({ status: 'running', completed: 0, total: 1 });
    expect(scenarioStatusForItem({ status: 'passed' })).toMatchObject({ status: 'completed', completed: 1, total: 1 });
    expect(scenarioStatusForItem({ status: 'error', error: 'failed to start' })).toMatchObject({ status: 'error', completed: 1, total: 1, error: 'failed to start' });
    expect(scenarioStatusForItem({ status: 'stopped' })).toMatchObject({ status: 'stopped', completed: 1, total: 1 });
  });

  it('advertises scenario control without changing protocol version', () => {
    expect(ROVER_CAPABILITIES).toContain('scenario_control');
    expect(registrationPayload('claude', 'https://claude.ai/chat/1', '1.2.3')).toMatchObject({
      protocolVersion: 2,
      capabilities: ['scenario_control', 'assignment_lease'],
    });
  });

  it('defines the complete lease release reason contract', () => {
    expect(ROVER_LEASE_RELEASE_REASONS).toEqual([
      'completed', 'error', 'stopped', 'connection_lost', 'provider_unavailable',
      'provider_mismatch', 'stale_provider', 'bound_tab_unavailable', 'terminal_error'
    ]);
  });
});
