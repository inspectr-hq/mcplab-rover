import type { RoverState } from '../contracts';
import { McplabClient } from '../mcplab/api-client';
import { saveState } from './store';
import { errorMessage } from './errors';

export async function complete(state: RoverState, text: string): Promise<RoverState> {
  const evaluating = { ...state, status: 'evaluating' as const, text };
  await saveState(evaluating);
  const completedAt = new Date().toISOString();
  const result = await new McplabClient(state.origin).complete(state.sessionId, {
    finalText: text,
    startedAt: state.startedAt,
    completedAt
  });
  const completed: RoverState = {
    ...evaluating,
    status: 'completed',
    completedAt,
    runId: result.runId,
    resultUrl: result.resultUrl,
    outcome: result.outcome,
    checkCounts: result.checkCounts
  };
  await saveState(completed);
  return completed;
}

export async function fail(state: RoverState, error: unknown): Promise<void> {
  try {
    await new McplabClient(state.origin).cancel(state.sessionId);
  } catch {
    // Preserve the original browser or evaluation error.
  }
  await saveState({
    ...state,
    status: 'error',
    error: errorMessage(error),
    completedAt: new Date().toISOString()
  });
}
