import { describe, expect, it } from 'vitest';
import { leaseDebugState } from '../src/background/socket';

describe('socket lifecycle state', () => {
  it('exposes a stable debug snapshot before registration', () => {
    expect(leaseDebugState()).toMatchObject({ negotiatedCapabilities: [] });
  });
});
