import { SMOKE_PROMPT, type RunState } from '../contracts';
import './style.css';

const provider = document.querySelector<HTMLParagraphElement>('#provider')!;
const run = document.querySelector<HTMLButtonElement>('#run')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const result = document.querySelector<HTMLPreElement>('#result')!;
const copy = document.querySelector<HTMLButtonElement>('#copy')!;

function render(state: RunState | null): void {
  const shell = document.querySelector<HTMLElement>('.shell')!;
  if (!state) {
    shell.dataset.state = 'ready';
    status.textContent = 'Ready';
    run.disabled = false;
    return;
  }
  shell.dataset.state = state.status;
  run.disabled = state.status === 'running';
  status.textContent = state.status === 'running' ? 'Waiting for response…' : state.status === 'completed' ? 'Completed' : `Error: ${state.error}`;
  if (state.text) {
    result.hidden = false;
    result.textContent = state.text;
    copy.hidden = false;
  }
}

chrome.runtime.sendMessage({ type: 'ROVER_GET_STATE' }).then((state: RunState | null) => render(state));

run.addEventListener('click', async () => {
  run.disabled = true;
  status.textContent = 'Starting…';
  const response = await chrome.runtime.sendMessage({ type: 'ROVER_START', prompt: SMOKE_PROMPT });
  if (!response?.ok) {
    status.textContent = `Error: ${response?.error ?? 'Could not start Rover'}`;
    run.disabled = false;
  } else {
    render(response.state);
  }
});

copy.addEventListener('click', async () => {
  if (result.textContent) await navigator.clipboard.writeText(result.textContent);
  status.textContent = 'Copied';
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session' || !changes['rover.run']) return;
  render(changes['rover.run'].newValue as RunState | null);
});

provider.textContent = 'Use the active Claude or TrendMiner chat tab';
