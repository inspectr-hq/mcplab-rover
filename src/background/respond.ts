import { errorMessage } from './errors';

export function respond<T>(
  sendResponse: (response: T | { ok: false; error: string }) => void,
  work: () => Promise<T>
): true {
  void work()
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
  return true;
}
