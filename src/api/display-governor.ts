/**
 * Deterministic per-device display policy. No I/O and no wall-clock reads.
 * Fetching/rendering never counts as exposure: only a matched panel-refresh ACK does.
 * Adapted from the isolated 2026-09-15 candidate; persistence lives in display-governor-store.
 */
export type Kind = 'news' | 'weather' | 'memo';
export interface Candidate {
  key: string;
  /** Stable article/event identity. The adapter must not invent semantic event clusters. */
  exposureKey: string;
  source: string;
  version: string;
  kind: Kind;
  eligibleFromMs: number;
  expiresAtMs: number;
  admitted: boolean;
  dataRef: string;
}
export interface Rule {
  minimumDwellMs: number;
  repeatCooldownMs: number;
  periodicIntervalMs: number | null;
}
export interface Policy {
  rules: Record<Kind, Rule>;
  sourceSilenceMs: number;
  firstDisplayBudgetMs: number;
  periodicLatenessMs: number;
  renderTimeoutMs: number;
  refreshAckTimeoutMs: number;
}
export const MINUTE = 60_000;
/** Defaults apply ONLY to explicitly enrolled devices, not existing production screens. */
export const DEFAULT_DISPLAY_POLICY: Policy = {
  rules: {
    news: { minimumDwellMs: MINUTE, repeatCooldownMs: 45 * MINUTE, periodicIntervalMs: null },
    weather: { minimumDwellMs: MINUTE, repeatCooldownMs: 30 * MINUTE, periodicIntervalMs: 30 * MINUTE },
    memo: { minimumDwellMs: MINUTE, repeatCooldownMs: 30 * MINUTE, periodicIntervalMs: 30 * MINUTE },
  },
  sourceSilenceMs: 60 * MINUTE,
  firstDisplayBudgetMs: 5 * MINUTE,
  periodicLatenessMs: 5 * MINUTE,
  renderTimeoutMs: 30_000,
  refreshAckTimeoutMs: 120_000,
};
export interface Frame { ref: string; sha256: string; width: number; height: number }
export type Reason = 'periodic-due' | 'first-display' | 'source-overdue' | 'rotation';
export interface Pending {
  id: string;
  generation: number;
  candidate: Candidate;
  reason: Reason;
  rule: Rule;
  reservedAtMs: number;
  deadlineMs: number;
  phase: 'reserved' | 'published';
  frame: Frame | null;
  publishedAtMs: number | null;
}
export interface Exposure {
  candidateKey: string; exposureKey: string; source: string; kind: Kind;
  version: string; acknowledgedAtMs: number; planId: string;
}
export interface Display {
  candidate: Candidate; planId: string; generation: number; frame: Frame;
  acknowledgedAtMs: number; protectedUntilMs: number;
}
export interface State {
  schema: 'quote0-display-governor/v1';
  deviceId: string;
  revision: number;
  generation: number;
  publishedGeneration: number;
  lastClockMs: number;
  pending: Pending | null;
  current: Display | null;
  lastByContent: Record<string, Exposure>;
  lastByExposure: Record<string, number>;
  lastBySource: Record<string, number>;
  lastByPeriodicStream: Record<string, number>;
  uncertainCooldownUntil: Record<string, number>;
  uncertainProtectedUntilMs: number;
}
export interface Selection { kind: 'select'; candidate: Candidate; reason: Reason }
export interface Hold {
  kind: 'hold';
  reason: 'in-flight' | 'minimum-dwell' | 'uncertain-refresh' | 'clock-regression' | 'no-eligible-content';
  wakeAtMs: number | null;
  excluded: Record<string, number>;
}
export interface Transition { state: State; decision: Selection | Hold; events: string[] }
export function initialState(deviceId: string): State {
  validId(deviceId, 'deviceId');
  return {
    schema: 'quote0-display-governor/v1', deviceId, revision: 0, generation: 0,
    publishedGeneration: 0, lastClockMs: 0, pending: null, current: null,
    lastByContent: {}, lastByExposure: {}, lastBySource: {}, lastByPeriodicStream: {},
    uncertainCooldownUntil: {}, uncertainProtectedUntilMs: 0,
  };
}
function validId(value: string, name: string): void {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 ||
      /[\u0000-\u001f]/.test(value) || ['__proto__', 'prototype', 'constructor'].includes(value)) {
    throw new Error(`Invalid ${name}`);
  }
}
function nonnegative(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${name}`);
}
function positive(value: number, name: string): void {
  nonnegative(value, name);
  if (!value) throw new Error(`Invalid ${name}`);
}
function clock(state: State, now: number): void {
  nonnegative(now, 'nowMs');
  if (now < state.lastClockMs) throw new Error('Clock regression');
}
export function validatePolicy(policy: Policy): void {
  for (const kind of ['news', 'weather', 'memo'] as const) {
    const rule = policy.rules[kind];
    positive(rule.minimumDwellMs, `${kind}.minimumDwellMs`);
    positive(rule.repeatCooldownMs, `${kind}.repeatCooldownMs`);
    if (rule.periodicIntervalMs !== null) positive(rule.periodicIntervalMs, `${kind}.periodicIntervalMs`);
    if (kind !== 'news' && rule.periodicIntervalMs === null) throw new Error('Periodic kind needs an interval');
    if (kind === 'news' && rule.periodicIntervalMs !== null) throw new Error('News cannot be periodic');
    if (rule.repeatCooldownMs < rule.minimumDwellMs) throw new Error('Cooldown is shorter than dwell');
  }
  for (const key of ['sourceSilenceMs', 'firstDisplayBudgetMs', 'periodicLatenessMs',
    'renderTimeoutMs', 'refreshAckTimeoutMs'] as const) positive(policy[key], key);
}
export function validateCandidate(c: Candidate): void {
  validId(c.key, 'key'); validId(c.exposureKey, 'exposureKey');
  validId(c.source, 'source'); validId(c.version, 'version'); validId(c.dataRef, 'dataRef');
  if (!['news', 'weather', 'memo'].includes(c.kind)) throw new Error('Invalid kind');
  if (typeof c.admitted !== 'boolean') throw new Error('Invalid admitted flag');
  nonnegative(c.eligibleFromMs, 'eligibleFromMs'); nonnegative(c.expiresAtMs, 'expiresAtMs');
  if (c.expiresAtMs <= c.eligibleFromMs) throw new Error('Invalid validity interval');
}
function stream(c: Candidate): string { return JSON.stringify([c.kind, c.source]); }
function own<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}
function hold(reason: Hold['reason'], wakeAtMs: number | null, excluded: Record<string, number> = {}): Hold {
  return { kind: 'hold', reason, wakeAtMs, excluded };
}
function bump(state: State, nowMs: number): State {
  const next = structuredClone(state);
  next.revision++;
  next.lastClockMs = nowMs;
  return next;
}
interface Ranked {
  candidate: Candidate; reason: Reason; deadline: number; periodic: boolean;
  unseen: boolean; sourceLast: number; contentLast: number;
}
export function choose(state: State, candidates: readonly Candidate[], nowMs: number, policy: Policy): Selection | Hold {
  validatePolicy(policy);
  nonnegative(nowMs, 'nowMs');
  if (nowMs < state.lastClockMs) return hold('clock-regression', state.lastClockMs);
  if (state.pending) return hold('in-flight', state.pending.deadlineMs);
  if (state.uncertainProtectedUntilMs > nowMs) return hold('uncertain-refresh', state.uncertainProtectedUntilMs);
  if (state.current && state.current.protectedUntilMs > nowMs) return hold('minimum-dwell', state.current.protectedUntilMs);
  const ranked: Ranked[] = [];
  const keys = new Set<string>();
  const excluded: Record<string, number> = {};
  let wake: number | null = null;
  const exclude = (reason: string, at: number | null = null): void => {
    excluded[reason] = (excluded[reason] ?? 0) + 1;
    if (at !== null && at > nowMs) wake = wake === null ? at : Math.min(wake, at);
  };
  for (const candidate of candidates) {
    validateCandidate(candidate);
    if (keys.has(candidate.key)) throw new Error('Catalog contains multiple versions of the same key');
    keys.add(candidate.key);
    const rule = policy.rules[candidate.kind];
    if (!candidate.admitted) { exclude('not-admitted'); continue; }
    if (candidate.eligibleFromMs > nowMs) { exclude('not-ready', candidate.eligibleFromMs); continue; }
    if (candidate.expiresAtMs < nowMs + policy.renderTimeoutMs + policy.refreshAckTimeoutMs + rule.minimumDwellMs) {
      exclude('expires-before-dwell'); continue;
    }
    const content = own(state.lastByContent, candidate.key);
    const lastExposure = own(state.lastByExposure, candidate.exposureKey);
    const lastPeriodic = own(state.lastByPeriodicStream, stream(candidate));
    const coolUntil = Math.max(
      lastExposure === undefined ? 0 : lastExposure + rule.repeatCooldownMs,
      own(state.uncertainCooldownUntil, candidate.exposureKey) ?? 0,
      rule.periodicIntervalMs !== null && lastPeriodic !== undefined
        ? lastPeriodic + Math.max(rule.repeatCooldownMs, rule.periodicIntervalMs) : 0,
    );
    if (coolUntil > nowMs) { exclude('cooldown', coolUntil); continue; }
    const unseen = content?.version !== candidate.version;
    const sourceLast = own(state.lastBySource, candidate.source) ?? candidate.eligibleFromMs;
    const sourceDeadline = sourceLast + policy.sourceSilenceMs;
    const firstDeadline = unseen ? candidate.eligibleFromMs + policy.firstDisplayBudgetMs : Infinity;
    const periodic = rule.periodicIntervalMs !== null;
    const periodicDue = periodic
      ? (lastPeriodic === undefined ? candidate.eligibleFromMs : lastPeriodic + rule.periodicIntervalMs!) : Infinity;
    const deadline = periodic ? periodicDue + policy.periodicLatenessMs : Math.min(sourceDeadline, firstDeadline);
    const reason: Reason = periodic ? 'periodic-due'
      : sourceDeadline <= nowMs && sourceDeadline <= firstDeadline ? 'source-overdue'
      : unseen ? 'first-display' : 'rotation';
    ranked.push({ candidate, deadline, periodic, unseen, sourceLast, contentLast: lastExposure ?? -1, reason });
  }
  ranked.sort((a, b) => {
    const aLate = a.deadline <= nowMs, bLate = b.deadline <= nowMs;
    // A cold-start news backlog can have hours-old first-display deadlines. Once a
    // periodic card exceeds its lateness budget it gets a bounded slot, not an
    // unbounded wait behind that backlog. Cooldown and current dwell were checked first.
    const aPeriodicLate = a.periodic && aLate, bPeriodicLate = b.periodic && bLate;
    if (aPeriodicLate !== bPeriodicLate) return aPeriodicLate ? -1 : 1;
    if (aLate !== bLate) return aLate ? -1 : 1;
    if (aLate && a.deadline !== b.deadline) return a.deadline - b.deadline;
    if (a.periodic !== b.periodic) return a.periodic ? -1 : 1;
    if (a.unseen !== b.unseen) return a.unseen ? -1 : 1;
    return a.sourceLast - b.sourceLast || a.contentLast - b.contentLast ||
      b.candidate.eligibleFromMs - a.candidate.eligibleFromMs || a.candidate.key.localeCompare(b.candidate.key);
  });
  const best = ranked[0];
  return best ? { kind: 'select', candidate: structuredClone(best.candidate), reason: best.reason }
    : hold('no-eligible-content', wake, excluded);
}
/** Row-lock/CAS the returned state BEFORE rendering. */
export function reserve(state: State, candidates: readonly Candidate[], nowMs: number, policy: Policy): Transition {
  validatePolicy(policy);
  nonnegative(nowMs, 'nowMs');
  if (nowMs < state.lastClockMs) return { state, decision: hold('clock-regression', state.lastClockMs), events: [] };
  if (state.pending && nowMs >= state.pending.deadlineMs) {
    const old = state.pending;
    const next = bump(state, nowMs);
    next.pending = null;
    if (old.phase === 'published') {
      next.uncertainProtectedUntilMs = Math.max(next.uncertainProtectedUntilMs, nowMs + old.rule.minimumDwellMs);
      next.uncertainCooldownUntil[old.candidate.exposureKey] =
        Math.max(own(next.uncertainCooldownUntil, old.candidate.exposureKey) ?? 0, nowMs + old.rule.repeatCooldownMs);
    }
    return { state: next, decision: hold(old.phase === 'published' ? 'uncertain-refresh' : 'no-eligible-content',
      old.phase === 'published' ? next.uncertainProtectedUntilMs : nowMs),
      events: [old.phase === 'published' ? 'refresh-ack-timeout' : 'render-timeout'] };
  }
  const decision = choose(state, candidates, nowMs, policy);
  if (decision.kind === 'hold') return { state, decision, events: [] };
  const next = bump(state, nowMs);
  next.generation++;
  next.pending = {
    id: JSON.stringify([state.deviceId, next.generation]), generation: next.generation,
    candidate: structuredClone(decision.candidate), reason: decision.reason,
    rule: structuredClone(policy.rules[decision.candidate.kind]), reservedAtMs: nowMs,
    deadlineMs: nowMs + policy.renderTimeoutMs, phase: 'reserved', frame: null, publishedAtMs: null,
  };
  return { state: next, decision, events: ['reserved'] };
}
export function publish(state: State, planId: string, frame: Frame, nowMs: number, policy: Policy): State {
  validatePolicy(policy);
  clock(state, nowMs);
  const pending = state.pending;
  if (!pending || pending.id !== planId || pending.phase !== 'reserved') throw new Error('Stale publication');
  validId(frame.ref, 'frame.ref');
  if (!/^[a-f0-9]{64}$/.test(frame.sha256)) throw new Error('Invalid frame hash');
  positive(frame.width, 'frame.width'); positive(frame.height, 'frame.height');
  if (nowMs >= pending.deadlineMs) throw new Error('Render lease expired');
  if (nowMs + policy.refreshAckTimeoutMs + pending.rule.minimumDwellMs > pending.candidate.expiresAtMs) {
    throw new Error('Content expires before protected display can finish');
  }
  const next = bump(state, nowMs);
  next.publishedGeneration = pending.generation;
  next.pending = { ...structuredClone(pending), phase: 'published', frame: structuredClone(frame),
    publishedAtMs: nowMs, deadlineMs: nowMs + policy.refreshAckTimeoutMs };
  return next;
}
export interface RefreshAck { deviceId: string; planId: string; sha256: string; result: 'refreshed' | 'failed' }
export function acknowledge(state: State, ack: RefreshAck, receivedAtMs: number): { state: State; accepted: boolean; reason: string } {
  clock(state, receivedAtMs);
  const pending = state.pending;
  if (ack.deviceId !== state.deviceId || !pending || pending.id !== ack.planId ||
      pending.phase !== 'published' || !pending.frame || pending.frame.sha256 !== ack.sha256) {
    return { state, accepted: false, reason: 'stale-or-mismatched-ack' };
  }
  if (receivedAtMs >= pending.deadlineMs) return { state, accepted: false, reason: 'late-ack' };
  if (ack.result !== 'refreshed') return { state, accepted: false, reason: 'refresh-not-confirmed' };
  const next = bump(state, receivedAtMs);
  const candidate = pending.candidate;
  next.current = { candidate: structuredClone(candidate), planId: pending.id, generation: pending.generation,
    frame: structuredClone(pending.frame), acknowledgedAtMs: receivedAtMs,
    protectedUntilMs: receivedAtMs + pending.rule.minimumDwellMs };
  next.pending = null;
  next.lastByContent[candidate.key] = { candidateKey: candidate.key, exposureKey: candidate.exposureKey,
    source: candidate.source, kind: candidate.kind, version: candidate.version,
    acknowledgedAtMs: receivedAtMs, planId: pending.id };
  next.lastByExposure[candidate.exposureKey] = receivedAtMs;
  next.lastBySource[candidate.source] = receivedAtMs;
  if (candidate.kind !== 'news') next.lastByPeriodicStream[stream(candidate)] = receivedAtMs;
  delete next.uncertainCooldownUntil[candidate.exposureKey];
  return { state: next, accepted: true, reason: 'refresh-confirmed' };
}
export interface AuthorizedFrame { deviceId: string; planId: string; generation: number; frame: Frame }
/** null = no NEW frame, never an instruction to blank a panel or fall back to an older frame. */
export function authorizedFrame(state: State, nowMs: number): AuthorizedFrame | null {
  clock(state, nowMs);
  if (state.pending?.phase === 'published') {
    if (nowMs >= state.pending.deadlineMs || nowMs >= state.pending.candidate.expiresAtMs || !state.pending.frame) return null;
    return { deviceId: state.deviceId, planId: state.pending.id, generation: state.pending.generation,
      frame: structuredClone(state.pending.frame) };
  }
  if (state.uncertainProtectedUntilMs > nowMs || !state.current ||
      state.current.generation < state.publishedGeneration || state.current.candidate.expiresAtMs <= nowMs) return null;
  return { deviceId: state.deviceId, planId: state.current.planId, generation: state.current.generation,
    frame: structuredClone(state.current.frame) };
}
/** Bound JSON state growth without losing any relevant cooldown (runtime policies <=24h). */
export function pruneExposureHistory(state: State, nowMs: number): State {
  const next = structuredClone(state);
  const cutoff = nowMs - 48 * 60 * MINUTE;
  for (const [key, value] of Object.entries(next.lastByContent)) {
    if (value.acknowledgedAtMs < cutoff) delete next.lastByContent[key];
  }
  for (const map of [next.lastByExposure, next.lastBySource, next.lastByPeriodicStream]) {
    for (const [key, value] of Object.entries(map)) if (value < cutoff) delete map[key];
  }
  for (const [key, until] of Object.entries(next.uncertainCooldownUntil)) {
    if (until <= nowMs) delete next.uncertainCooldownUntil[key];
  }
  return next;
}
