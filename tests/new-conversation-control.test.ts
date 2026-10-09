// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  resolveNewConversationControl,
  newConversationTargetUrl
} from '../src/providers/new-conversation-control';
import { queryShadowLocator } from '../src/providers/shadow-locator';

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 10,
    height: 10
  } as DOMRect);
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it.each([
  '<button aria-label="New chat"></button>',
  '<button title="New conversation"></button>',
  '<button data-testid="start-new-thread"></button>',
  '<button data-testid="newChat"></button>',
  '<button data-test="sidebarNewConversation"></button>',
  '<button data-testid="AIChatNewThread"></button>',
  '<button data-test="newCHAT"></button>',
  '<button data-testid="new-chat-button"></button>',
  '<button data-testid="create-new-chat-button"></button>',
  '<button data-testid="sidebar_new_chat_btn"></button>',
  '<button data-testid="newChatButton"></button>',
  '<button>Start a new conversation</button>',
  '<a href="/new">New chat</a>'
])('accepts an explicit New Chat action: %s', (markup) => {
  document.body.innerHTML = markup;
  expect(resolveNewConversationControl(document.body.firstElementChild as HTMLElement)).toBe(
    document.body.firstElementChild
  );
});

it.each([
  '<button disabled title="New chat"></button>',
  '<button aria-disabled="true" title="New chat"></button>',
  '<a href="/c/old" aria-label="New chat">New chat</a>',
  '<div tabindex="0">Start a new conversation</div>',
  '<button>How do I start a new chat?</button>',
  '<div title="New chat"><button>One</button><button>Two</button></div>',
  '<div title="New chat">A sidebar conversation title</div>',
  '<div title="New chat"><a href="/c/old">New chat</a></div>',
  '<div tabindex="0" title="New chat"><a href="/c/old">New chat</a></div>',
  '<chat-control data-test="new-chat"><button disabled>+</button></chat-control>',
  '<chat-control data-test="new-chat-menu"><button>More options</button></chat-control>',
  '<chat-control data-test="newChatMenu"><button>More options</button></chat-control>',
  '<chat-control data-test="newChatMenu"><button>+</button></chat-control>',
  '<button data-testid="newChatMenu"></button>',
  '<chat-control data-testid="newChatButton"><button aria-label="More options"></button></chat-control>',
  '<chat-control data-test="new-chat"><button aria-label="More options"></button></chat-control>',
  '<chat-control data-test="new-chat"><button>More options</button></chat-control>',
  '<a title="New chat" href="http://[broken">New chat</a>'
])('rejects a nonaction or ambiguous New Chat match: %s', (markup) => {
  document.body.innerHTML = markup;
  expect(resolveNewConversationControl(document.body.firstElementChild as HTMLElement)).toBeNull();
});

it('resolves an anonymous shadow child through the labeled host', () => {
  const host = document.createElement('chat-control');
  host.setAttribute('data-test', 'new-chat');
  document.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<button>+</button>';
  expect(resolveNewConversationControl(host)).toBe(shadow.querySelector('button'));
  expect(resolveNewConversationControl(shadow.querySelector('button')!)).toBe(
    shadow.querySelector('button')
  );
});

it('does not escape a missing shadow root to match another chat', () => {
  document.body.innerHTML =
    '<chat-host></chat-host><div class="answer">Unrelated</div><other-chat></other-chat>';
  const shadow = document.querySelector('other-chat')!.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<div class="answer">Another chat</div>';
  expect(queryShadowLocator({ segments: ['chat-host', '.answer'] })).toEqual([]);
});

it('supports ancestor segments without searching outside the matched ancestor', () => {
  document.body.innerHTML =
    '<main id="chat"><textarea></textarea><div class="answer">Right</div></main><div class="answer">Unrelated</div>';
  expect(queryShadowLocator({ segments: ['#chat', 'textarea'] })).toEqual([
    document.querySelector('textarea')
  ]);
  expect(queryShadowLocator({ segments: ['#chat', '.answer'] })).toEqual([
    document.querySelector('#chat .answer')
  ]);
});

it('supports mixed shadow and light DOM ancestor segments', () => {
  document.body.innerHTML = '<chat-host></chat-host><div class="answer">Outside</div>';
  const shadow = document.querySelector('chat-host')!.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<main><div class="answer">Inside</div></main><div class="answer">Other</div>';
  expect(queryShadowLocator({ segments: ['chat-host', 'main', '.answer'] })).toEqual([
    shadow.querySelector('main .answer')
  ]);
});

it('ignores malformed target URLs without throwing', () => {
  document.body.innerHTML = '<a title="New chat" href="http://[broken">New chat</a>';
  expect(newConversationTargetUrl(document.querySelector('a')!)).toBeUndefined();
});
