import type { BrowserProviderProfile, ShadowLocator } from '../mcplab/types';

function validSelector(selector: unknown): selector is string {
  if (typeof selector !== 'string' || selector.trim() === '') return false;
  try {
    document.querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

function validLocator(value: unknown, required = true): value is ShadowLocator {
  if (!value) return !required;
  if (typeof value !== 'object') return false;
  const segments = (value as { segments?: unknown }).segments;
  return Array.isArray(segments) && segments.length > 0 && segments.every(validSelector);
}

export function isValidBrowserProviderProfile(value: unknown): value is BrowserProviderProfile {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Partial<BrowserProviderProfile>;
  if (profile.schemaVersion !== 1 || typeof profile.id !== 'string' || !profile.id || typeof profile.name !== 'string') return false;
  if (!profile.match || !Array.isArray(profile.match.origins) || profile.match.origins.length === 0 || !profile.match.origins.every((origin) => typeof origin === 'string' && origin.length > 0)) return false;
  if (!profile.composer || !validLocator(profile.composer.locator)) return false;
  if (!['input', 'textarea', 'contenteditable'].includes(profile.composer.inputMode)) return false;
  if (!profile.submit || !['click', 'enter'].includes(profile.submit.action)) return false;
  if (profile.submit.action === 'click' && !validLocator(profile.submit.locator)) return false;
  if (!profile.assistantMessages || !validLocator(profile.assistantMessages.locator) || !validLocator(profile.assistantMessages.textLocator, false)) return false;
  if (!profile.completion || !Number.isFinite(profile.completion.stabilityMs) || profile.completion.stabilityMs < 0) return false;
  if (profile.completion.generatingLocator && !validLocator(profile.completion.generatingLocator)) return false;
  if (profile.completion.idleLocator && !validLocator(profile.completion.idleLocator)) return false;
  if (profile.newConversation) {
    if (!['click', 'navigate'].includes(profile.newConversation.action)) return false;
    if (profile.newConversation.action === 'click' && !validLocator(profile.newConversation.locator)) return false;
    if (profile.newConversation.action === 'navigate' && typeof profile.newConversation.url !== 'string') return false;
  }
  return true;
}
