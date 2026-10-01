// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { adapters, setLearnedProfiles } from './index';
import { claudeAdapter } from './claude';
import { chatgptAdapter } from './chatgpt';

describe('provider catalog loading', () => {
  afterEach(() => setLearnedProfiles([]));

  it('keeps native adapters when MCP Lab returns built-in profiles', () => {
    const profile = {
      id: 'claude',
      schemaVersion: 1,
      name: 'Claude',
      source: 'builtin',
      match: { origins: ['https://claude.ai'] },
      composer: { locator: { segments: ['textarea'] }, inputMode: 'textarea' },
      submit: { action: 'enter' },
      assistantMessages: { locator: { segments: ['.assistant'] } },
      completion: { stabilityMs: 2500 },
      learned: {
        sourceOrigin: 'https://claude.ai',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
        confidence: {}
      }
    };
    setLearnedProfiles([profile]);

    expect(adapters.find((adapter) => adapter.id === 'claude')).toBe(claudeAdapter);

    setLearnedProfiles([{ ...profile, source: 'workspace' }]);
    expect(adapters.find((adapter) => adapter.id === 'claude')).not.toBe(claudeAdapter);
  });

  it('keeps native ChatGPT when MCP Lab returns its built-in profile', () => {
    setLearnedProfiles([
      {
        id: 'chatgpt-com',
        schemaVersion: 1,
        name: 'ChatGPT',
        source: 'builtin',
        match: { origins: ['https://chatgpt.com'] },
        composer: { locator: { segments: ['textarea'] }, inputMode: 'textarea' },
        submit: { action: 'enter' },
        assistantMessages: { locator: { segments: ['.assistant'] } },
        completion: { stabilityMs: 2500 },
        learned: {
          sourceOrigin: 'https://chatgpt.com',
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z',
          confidence: {}
        }
      }
    ]);

    expect(adapters.find((adapter) => adapter.id === 'chatgpt-com')).toBe(chatgptAdapter);
  });

  it('keeps workspace profiles while ignoring built-ins in a mixed list', () => {
    setLearnedProfiles([
      {
        id: 'claude',
        schemaVersion: 1,
        name: 'Claude built-in',
        source: 'builtin',
        match: { origins: ['https://claude.ai'] },
        composer: { locator: { segments: ['textarea'] }, inputMode: 'textarea' },
        submit: { action: 'enter' },
        assistantMessages: { locator: { segments: ['.assistant'] } },
        completion: { stabilityMs: 2500 },
        learned: {
          sourceOrigin: 'https://claude.ai',
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z',
          confidence: {}
        }
      },
      {
        id: 'custom-browser',
        schemaVersion: 1,
        name: 'Custom browser',
        source: 'workspace',
        match: { origins: ['https://custom.example'] },
        composer: { locator: { segments: ['textarea'] }, inputMode: 'textarea' },
        submit: { action: 'enter' },
        assistantMessages: { locator: { segments: ['.assistant'] } },
        completion: { stabilityMs: 2500 },
        learned: {
          sourceOrigin: 'https://custom.example',
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z',
          confidence: {}
        }
      }
    ]);

    expect(adapters.map((adapter) => adapter.id)).toEqual([
      'custom-browser',
      'claude',
      'chatgpt-com'
    ]);
  });
});
