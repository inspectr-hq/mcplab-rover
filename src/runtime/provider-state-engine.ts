import type { ResponseCandidate } from './candidate-selection';

export type ProviderExecutionState =
  | 'idle'
  | 'submitted'
  | 'waiting'
  | 'generating'
  | 'working'
  | 'finished'
  | 'error'
  | 'unknown';

export type ProviderRawSignalName =
  | 'generation_active'
  | 'stop_visible'
  | 'working_visible'
  | 'idle_visible'
  | 'input_enabled'
  | 'assistant_busy'
  | 'error_visible';

export type ProviderSignalName =
  | ProviderRawSignalName
  | 'response_present'
  | 'response_mutating'
  | 'response_identity_changed';

export interface SelectedResponseObservation {
  identity: string;
  text: string;
  belongsToRequest: boolean;
}

export interface ProviderObservation {
  observedAt: number;
  response: SelectedResponseObservation | null;
  responseObserved?: boolean;
  historicalGenerationObserved?: boolean;
  signals: Partial<Record<ProviderRawSignalName, boolean>>;
  error?: string | null;
  completionSignal?: string;
}

export interface ProviderSignalEvaluator {
  evaluate(candidates: ResponseCandidate[], observedAt: number): ProviderObservation;
}

export interface ProviderStateEngineOptions {
  quietPeriodMs: number;
  minResponseAgeMs: number;
  timeoutMs: number;
  requireGenerationSignal: boolean;
  minimumStateDurationMs?: Partial<Record<ProviderExecutionState, number>>;
}

export interface EvidenceRecord {
  signal: ProviderSignalName;
  at: number;
  value: boolean;
}

export interface StateTransition {
  from: ProviderExecutionState;
  to: ProviderExecutionState;
  at: number;
  positiveEvidence: EvidenceRecord[];
  blockingEvidence: EvidenceRecord[];
  anomaly?: 'post-terminal-observation';
}

export interface ProviderStateSnapshot {
  state: ProviderExecutionState;
  terminal: boolean;
  observedAt: number;
  stateSince: number;
  responseIdentity?: string;
  generationObserved: boolean;
  responseObserved: boolean;
  terminalReason?: 'timeout' | 'incomplete' | 'provider-error';
  errorMessage?: string;
  signals: Record<ProviderSignalName, boolean>;
  positiveEvidence: EvidenceRecord[];
  blockingEvidence: EvidenceRecord[];
  historicalEvidence: EvidenceRecord[];
  history: StateTransition[];
}

const HISTORY_LIMIT = 32;

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function terminal(state: ProviderExecutionState): boolean {
  return state === 'finished' || state === 'error';
}

function evidence(
  signals: Record<ProviderSignalName, boolean>,
  at: number,
  names: ProviderSignalName[]
): EvidenceRecord[] {
  return names
    .filter((signal) => signals[signal])
    .map((signal) => ({ signal, at, value: true }));
}

function hasOwn<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export class ProviderStateEngine {
  private readonly options: ProviderStateEngineOptions;
  private readonly startedAt: number;
  private submittedAt: number | null = null;
  private state: ProviderExecutionState = 'idle';
  private stateSince: number;
  private lastResponseIdentity: string | undefined;
  private lastResponseText: string | undefined;
  private lastResponsePresent = false;
  private lastResponseActivityAt: number | null = null;
  private providerReadySince: number | null = null;
  private generationObserved = false;
  private responseObserved = false;
  private terminalReason: ProviderStateSnapshot['terminalReason'];
  private errorMessage: string | undefined;
  private signals: Record<ProviderSignalName, boolean> = {
    generation_active: false,
    stop_visible: false,
    working_visible: false,
    idle_visible: false,
    input_enabled: false,
    assistant_busy: false,
    error_visible: false,
    response_present: false,
    response_mutating: false,
    response_identity_changed: false
  };
  private positiveEvidence: EvidenceRecord[] = [];
  private blockingEvidence: EvidenceRecord[] = [];
  private historicalEvidence: EvidenceRecord[] = [];
  private history: StateTransition[] = [];

  constructor(options: ProviderStateEngineOptions, startedAt = Date.now()) {
    this.options = options;
    this.startedAt = startedAt;
    this.stateSince = startedAt;
  }

  markSubmitted(at = Date.now()): ProviderStateSnapshot {
    if (terminal(this.state)) return this.snapshot(at);
    this.submittedAt = at;
    this.transition('submitted', at, [], []);
    return this.snapshot(at);
  }

  update(observation: ProviderObservation): ProviderStateSnapshot {
    if (terminal(this.state)) {
      const anomaly: StateTransition = {
        from: this.state,
        to: this.state,
        at: observation.observedAt,
        positiveEvidence: [],
        blockingEvidence: [],
        anomaly: 'post-terminal-observation'
      };
      this.history = [
        ...this.history,
        anomaly
      ].slice(-HISTORY_LIMIT);
      return this.snapshot(observation.observedAt);
    }

    const at = observation.observedAt;
    const selectedResponse =
      observation.response?.belongsToRequest && normalize(observation.response.text)
        ? observation.response
        : null;
    const responsePresent = Boolean(selectedResponse);
    const responseIdentityChanged =
      responsePresent &&
      this.lastResponseIdentity !== undefined &&
      selectedResponse!.identity !== this.lastResponseIdentity;
    const responseTextChanged =
      responsePresent &&
      this.lastResponseText !== undefined &&
      normalize(selectedResponse!.text) !== this.lastResponseText;
    const responsePresenceChanged = responsePresent !== this.lastResponsePresent;
    const responseActivity =
      responsePresent &&
      (responsePresenceChanged ||
        responseIdentityChanged ||
        responseTextChanged);

    if (responseActivity) this.lastResponseActivityAt = at;
    if (responsePresent) {
      this.lastResponseIdentity = selectedResponse!.identity;
      this.lastResponseText = normalize(selectedResponse!.text);
    }
    this.lastResponsePresent = responsePresent;

    const raw = observation.signals;
    const generationActive = Boolean(raw.generation_active || raw.stop_visible);
    const working = Boolean(raw.working_visible || raw.assistant_busy);
    const responseMutating =
      this.lastResponseActivityAt !== null &&
      at - this.lastResponseActivityAt < Math.max(0, this.options.quietPeriodMs);
    const errorVisible = Boolean(raw.error_visible || observation.error);
    const idleKnown = hasOwn(raw, 'idle_visible') || hasOwn(raw, 'input_enabled');
    const idleVisible = hasOwn(raw, 'idle_visible')
      ? raw.idle_visible === true
      : raw.input_enabled === true;

    const providerBlocked = generationActive || working || (idleKnown && !idleVisible);
    if (providerBlocked || !responsePresent || !idleKnown || !idleVisible)
      this.providerReadySince = null;
    else if (this.providerReadySince === null) this.providerReadySince = at;

    const generationWasObserved = this.generationObserved;
    const responseWasObserved = this.responseObserved;
    this.generationObserved ||=
      generationActive || observation.historicalGenerationObserved === true;
    this.responseObserved ||= observation.responseObserved === true;
    this.signals = {
      generation_active: generationActive,
      stop_visible: raw.stop_visible === true,
      working_visible: raw.working_visible === true,
      idle_visible: raw.idle_visible === true,
      input_enabled: raw.input_enabled === true,
      assistant_busy: raw.assistant_busy === true,
      error_visible: errorVisible,
      response_present: responsePresent,
      response_mutating: responseMutating,
      response_identity_changed: responseIdentityChanged
    };
    this.positiveEvidence = evidence(this.signals, at, [
      'response_present',
      'idle_visible',
      'input_enabled',
      'response_identity_changed'
    ]);
    this.blockingEvidence = evidence(this.signals, at, [
      'generation_active',
      'stop_visible',
      'working_visible',
      'assistant_busy',
      'response_mutating',
      'error_visible'
    ]);
    if (!generationWasObserved && this.generationObserved)
      this.historicalEvidence.push({ signal: 'generation_active', at, value: true });
    if (!responseWasObserved && this.responseObserved)
      this.historicalEvidence.push({ signal: 'response_present', at, value: true });
    this.historicalEvidence = this.historicalEvidence.slice(-HISTORY_LIMIT);

    if (this.submittedAt === null) return this.snapshot(at);
    if (at - this.submittedAt >= this.options.timeoutMs) {
      this.terminalReason = 'timeout';
      this.errorMessage = 'Timed out waiting for completed response';
      this.transition('error', at, this.positiveEvidence, this.blockingEvidence);
      return this.snapshot(at);
    }

    let next: ProviderExecutionState;
    if (errorVisible) {
      this.terminalReason = 'provider-error';
      this.errorMessage = observation.error || 'Provider reported an error.';
      next = 'error';
    }
    else if (!responsePresent) next = 'waiting';
    else if (responseMutating) next = 'generating';
    else if (working) next = 'working';
    else if (generationActive) next = 'generating';
    else if (!idleKnown || !idleVisible) next = 'unknown';
    else if (at - this.submittedAt < this.options.minResponseAgeMs) next = 'unknown';
    else if (
      this.lastResponseActivityAt === null ||
      at - this.lastResponseActivityAt < Math.max(0, this.options.quietPeriodMs) ||
      this.providerReadySince === null ||
      at - this.providerReadySince < Math.max(0, this.options.quietPeriodMs)
    )
      next = 'unknown';
    else if (
      this.options.requireGenerationSignal &&
      !this.generationObserved &&
      !this.responseObserved
    ) {
      this.terminalReason = 'incomplete';
      this.errorMessage = 'Response capture incomplete: generation was never observed';
      this.transition('error', at, this.positiveEvidence, this.blockingEvidence);
      return this.snapshot(at);
    } else next = 'finished';

    const minimumDuration = Math.max(
      0,
      this.options.minimumStateDurationMs?.[this.state] ?? 0
    );
    if (next !== this.state && at - this.stateSince < minimumDuration) next = this.state;
    this.transition(next, at, this.positiveEvidence, this.blockingEvidence);
    return this.snapshot(at);
  }

  snapshot(at = Date.now()): ProviderStateSnapshot {
    return {
      state: this.state,
      terminal: terminal(this.state),
      observedAt: at,
      stateSince: this.stateSince,
      ...(this.lastResponseIdentity ? { responseIdentity: this.lastResponseIdentity } : {}),
      generationObserved: this.generationObserved,
      responseObserved: this.responseObserved,
      ...(this.terminalReason ? { terminalReason: this.terminalReason } : {}),
      ...(this.errorMessage ? { errorMessage: this.errorMessage } : {}),
      signals: { ...this.signals },
      positiveEvidence: [...this.positiveEvidence],
      blockingEvidence: [...this.blockingEvidence],
      historicalEvidence: [...this.historicalEvidence],
      history: [...this.history]
    };
  }

  private transition(
    next: ProviderExecutionState,
    at: number,
    positiveEvidence: EvidenceRecord[],
    blockingEvidence: EvidenceRecord[]
  ): void {
    if (next === this.state) return;
    this.history = [
      ...this.history,
      {
        from: this.state,
        to: next,
        at,
        positiveEvidence: [...positiveEvidence],
        blockingEvidence: [...blockingEvidence]
      }
    ].slice(-HISTORY_LIMIT);
    this.state = next;
    this.stateSince = at;
  }
}
