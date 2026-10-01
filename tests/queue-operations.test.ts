import { describe, expect, it } from 'vitest';
import { serializeQueueOperation } from '../src/queue/operations';

describe('queue operation serialization', () => {
  it('runs overlapping operations one at a time', async () => {
    const events: string[] = [];
    let release!: () => void;
    const first = serializeQueueOperation(async () => {
      events.push('first-start');
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      events.push('first-end');
    });
    const second = serializeQueueOperation(async () => {
      events.push('second');
    });

    await Promise.resolve();
    expect(events).toEqual(['first-start']);
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(['first-start', 'first-end', 'second']);
  });
});
