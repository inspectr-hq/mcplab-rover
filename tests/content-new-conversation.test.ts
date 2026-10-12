// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

const providers = vi.hoisted(() => ({ findAdapter: vi.fn() }));
vi.mock('../src/providers', () => ({
  findAdapter: providers.findAdapter,
  findPageAdapter: providers.findAdapter,
  findPageAdapters: vi.fn(() => []),
  setLearnedProfiles: vi.fn()
}));

afterEach(() => {
  delete (globalThis as { __mcplabRoverInstalled?: boolean }).__mcplabRoverInstalled;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

async function content(adapter: unknown) {
  vi.resetModules();
  providers.findAdapter.mockReturnValue(adapter);
  let listener!: (message: unknown, sender: unknown, respond: unknown) => void;
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      onMessage: {
        addListener: (callback: typeof listener) => {
          listener = callback;
        }
      }
    },
    storage: { local: { get: vi.fn().mockResolvedValue({}) }, onChanged: { addListener: vi.fn() } }
  });
  await import('../src/content');
  return listener;
}

it('returns a navigation intent before the old content script can unload', async () => {
  const startNewConversation = vi.fn();
  const listener = await content({
    id: 'polo',
    startNewConversation,
    getNewConversationUrl: () => 'https://polo.example/new'
  });
  const respond = vi.fn();
  listener({ type: 'ROVER_NEW_CHAT' }, {}, respond);
  await Promise.resolve();
  expect(respond).toHaveBeenCalledWith({ ok: true, navigationUrl: 'https://polo.example/new' });
  expect(startNewConversation).not.toHaveBeenCalled();
});

it.each(['empty', 'draft', 'answers', 'cached-answers', 'hidden', 'missing'])(
  'checks fresh navigation readiness: %s',
  async (state) => {
    document.body.innerHTML = '<textarea></textarea>';
    const composer = document.querySelector('textarea')!;
    composer.value = state === 'draft' ? 'Unsent draft' : '';
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: state === 'hidden' ? 0 : 10,
      height: 10
    } as DOMRect);
    const listener = await content({
      id: 'polo',
      findComposer: () => (state === 'missing' ? null : composer),
      getAssistantCandidates: () =>
        state === 'answers'
          ? [{ key: 'previous', text: 'Previous answer', visible: true }]
          : state === 'cached-answers'
            ? [{ key: 'cached', text: 'Cached answer', visible: false }]
            : []
    });
    const respond = vi.fn();
    listener({ type: 'ROVER_NEW_CHAT_READY' }, {}, respond);
    expect(respond).toHaveBeenCalledWith({
      ok: true,
      provider: 'polo',
      ready: state === 'empty' || state === 'cached-answers'
    });
  }
);
