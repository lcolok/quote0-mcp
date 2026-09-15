import { describe, expect, test } from 'bun:test';
import { acknowledge, authorizedFrame, choose, DEFAULT_DISPLAY_POLICY, initialState, MINUTE,
  pruneExposureHistory, publish, reserve, validateCandidate, validatePolicy,
  type Candidate, type State } from './display-governor.js';
import { configuredGovernorDevices, displayGovernorPolicy } from './display-governor-config.js';

const T = 1_800_000_000_000;
const P = DEFAULT_DISPLAY_POLICY;
const F = { ref: 'immutable:fixture', sha256: 'a'.repeat(64), width: 296, height: 152 };
const news = (key = 'news:a', patch: Partial<Candidate> = {}): Candidate => ({
  key, exposureKey: key, source: 'solidot', version: 'article-v1', kind: 'news',
  eligibleFromMs: T - 10 * MINUTE, expiresAtMs: T + 24 * 60 * MINUTE,
  admitted: true, dataRef: `fixture:${key}`, ...patch,
});
const weather = (patch: Partial<Candidate> = {}): Candidate => news('weather:gz', {
  kind: 'weather', source: 'weather:amap:广州', version: 'sunny', ...patch,
});
function prepared(state: State, c: Candidate, at = T): State {
  const next = reserve(state, [c], at, P).state;
  return publish(next, next.pending!.id, F, at + 1, P);
}
function displayed(state: State, c: Candidate, at = T): State {
  const next = prepared(state, c, at);
  return acknowledge(next, { deviceId: state.deviceId, planId: next.pending!.id,
    sha256: F.sha256, result: 'refreshed' }, at + 2).state;
}

describe('unified per-device display governor', () => {
  test('first display creates a reservation but publishes nothing', () => {
    const s = reserve(initialState('screen'), [news()], T, P);
    expect(s.decision.kind).toBe('select');
    expect(s.state.pending?.phase).toBe('reserved');
    expect(authorizedFrame(s.state, T)).toBeNull();
    expect(Object.keys(s.state.lastByContent)).toHaveLength(0);
  });
  test('publication is not confirmed exposure', () => {
    const s = prepared(initialState('screen'), news());
    expect(authorizedFrame(s, T + 2)?.frame).toEqual(F);
    expect(s.current).toBeNull();
    expect(s.lastByExposure).toEqual({});
  });
  test('weather cannot be overwritten 0.486s after its refresh ACK', () => {
    const s = displayed(initialState('screen'), weather());
    expect(choose(s, [news()], T + 488, P)).toMatchObject({ kind: 'hold', reason: 'minimum-dwell' });
  });
  test('dwell starts at refresh, not reservation or HTTP delivery', () => {
    const s = prepared(initialState('screen'), weather());
    const ackAt = T + 90_000;
    const ack = acknowledge(s, { deviceId: 'screen', planId: s.pending!.id, sha256: F.sha256, result: 'refreshed' }, ackAt);
    expect(ack.state.current?.protectedUntilMs).toBe(ackAt + MINUTE);
    expect(choose(ack.state, [news()], ackAt + 59_999, P).kind).toBe('hold');
  });
  test('new article does not immediately replay twice to fill an old three-show budget', () => {
    const s = displayed(initialState('screen'), news());
    for (const minutes of [1, 2, 3, 20, 44]) {
      expect(choose(s, [news()], T + 2 + minutes * MINUTE, P).kind).toBe('hold');
    }
    expect(choose(s, [news()], T + 2 + 45 * MINUTE, P).kind).toBe('select');
  });
  test('source starvation priority cannot bypass article cooldown', () => {
    const s = displayed(initialState('screen'), news());
    s.lastBySource.solidot = T - 4 * 60 * MINUTE;
    expect(choose(s, [news()], T + 5 * MINUTE, P).kind).toBe('hold');
  });
  test('older admitted source is not hidden behind a global six-hour tier', () => {
    const old = news('old', { eligibleFromMs: T - 9 * 60 * MINUTE });
    const recent = news('new', { source: 'dev-to', eligibleFromMs: T });
    expect(choose(initialState('screen'), [recent, old], T, P)).toMatchObject({ candidate: { key: 'old' } });
  });
  test('overdue weather cannot starve behind a cold-start backlog of old news deadlines', () => {
    const backlog = Array.from({ length: 100 }, (_, index) => news(`backlog:${index}`, {
      eligibleFromMs: T - 12 * 60 * MINUTE, source: `source:${index % 8}`,
    }));
    const dueWeather = weather({ eligibleFromMs: T - 6 * MINUTE });
    expect(choose(initialState('screen'), [...backlog, dueWeather], T, P))
      .toMatchObject({ kind: 'select', candidate: { kind: 'weather' }, reason: 'periodic-due' });
  });
  test('weather insertion does not reset article cooldown', () => {
    let s = displayed(initialState('screen'), news());
    s = displayed(s, weather(), T + 2 * MINUTE);
    expect(choose(s, [news()], T + 10 * MINUTE, P).kind).toBe('hold');
  });
  test('new weather values do not reset its periodic display interval', () => {
    const s = displayed(initialState('screen'), weather());
    expect(choose(s, [weather({ version: 'raining' })], T + 5 * MINUTE, P).kind).toBe('hold');
  });
  test('weather alias key cannot bypass a shared city stream interval', () => {
    const s = displayed(initialState('screen'), weather());
    const alias = weather({ key: 'weather:alias', exposureKey: 'weather:alias' });
    expect(choose(s, [alias], T + 5 * MINUTE, P).kind).toBe('hold');
  });
  test('article rewrite/re-render cannot reset exposure cooldown', () => {
    const s = displayed(initialState('screen'), news());
    expect(choose(s, [news('news:a', { version: 'different-title' })], T + 5 * MINUTE, P).kind).toBe('hold');
  });
  test('trusted shared event identity prevents cross-source cooldown evasion', () => {
    const s = displayed(initialState('screen'), news('a', { exposureKey: 'event:1' }));
    const other = news('b', { exposureKey: 'event:1', source: 'hackernews' });
    expect(choose(s, [other], T + 5 * MINUTE, P).kind).toBe('hold');
  });
  test('each device owns its own exposure history', () => {
    displayed(initialState('one'), news());
    expect(choose(initialState('two'), [news()], T, P).kind).toBe('select');
  });
  test('JSON restore after restart preserves cooldown', () => {
    const state = JSON.parse(JSON.stringify(displayed(initialState('screen'), news()))) as State;
    expect(choose(state, [news()], T + 5 * MINUTE, P).kind).toBe('hold');
  });
  test.each([
    { name: 'HOLD/unadmitted', patch: { admitted: false } },
    { name: 'future', patch: { eligibleFromMs: T + MINUTE } },
    { name: 'expired', patch: { eligibleFromMs: T - MINUTE, expiresAtMs: T - 1 } },
    { name: 'expires before render+ACK+dwell', patch: { expiresAtMs: T + MINUTE } },
  ])('does not deliver $name', ({ patch }) => {
    expect(choose(initialState('screen'), [news('a', patch)], T, P).kind).toBe('hold');
  });
  test('empty supply is observable HOLD, not a silent cooldown bypass', () => {
    expect(choose(initialState('screen'), [], T, P)).toMatchObject({ kind: 'hold', reason: 'no-eligible-content' });
  });
  test('in-flight reservation excludes another decision', () => {
    const s = reserve(initialState('screen'), [news()], T, P).state;
    expect(reserve(s, [weather()], T + 1, P).decision).toMatchObject({ kind: 'hold', reason: 'in-flight' });
  });
  test('late renderer cannot publish an expired reservation', () => {
    const s = reserve(initialState('screen'), [news()], T, P).state;
    expect(() => publish(s, s.pending!.id, F, T + P.renderTimeoutMs, P)).toThrow('Render lease expired');
  });
  test('wrong plan cannot publish', () => {
    const s = reserve(initialState('screen'), [news()], T, P).state;
    expect(() => publish(s, 'another-plan', F, T + 1, P)).toThrow('Stale publication');
  });
  test('render timeout does not fabricate exposure', () => {
    const s = reserve(initialState('screen'), [news()], T, P).state;
    const result = reserve(s, [news()], T + P.renderTimeoutMs + 1, P);
    expect(result.events).toEqual(['render-timeout']);
    expect(result.state.lastByExposure).toEqual({});
  });
  test('ACK timeout is unknown, not a fake success, and cannot roll back to the previous frame', () => {
    let s = displayed(initialState('screen'), news());
    s = prepared(s, weather(), T + 2 * MINUTE);
    const result = reserve(s, [], s.pending!.deadlineMs + 1, P);
    expect(result.events).toEqual(['refresh-ack-timeout']);
    expect(result.state.lastByContent['weather:gz']).toBeUndefined();
    expect(authorizedFrame(result.state, result.state.uncertainProtectedUntilMs + 1)).toBeNull();
  });
  test.each(['wrong-device', 'wrong-plan', 'wrong-hash', 'failed'] as const)('rejects %s ACK', mode => {
    const s = prepared(initialState('screen'), news());
    const result = acknowledge(s, { deviceId: mode === 'wrong-device' ? 'other' : 'screen',
      planId: mode === 'wrong-plan' ? 'other' : s.pending!.id,
      sha256: mode === 'wrong-hash' ? 'b'.repeat(64) : F.sha256,
      result: mode === 'failed' ? 'failed' : 'refreshed' }, T + 2);
    expect(result.accepted).toBe(false);
    expect(result.state).toEqual(s);
  });
  test('late ACK is not backdated into a confirmed exposure', () => {
    const s = prepared(initialState('screen'), news());
    expect(acknowledge(s, { deviceId: 'screen', planId: s.pending!.id, sha256: F.sha256,
      result: 'refreshed' }, s.pending!.deadlineMs).accepted).toBe(false);
  });
  test('duplicate ACK does not extend minimum dwell', () => {
    const p = prepared(initialState('screen'), news());
    const ack = { deviceId: 'screen', planId: p.pending!.id, sha256: F.sha256, result: 'refreshed' as const };
    const s = acknowledge(p, ack, T + 2).state;
    expect(acknowledge(s, ack, T + 20_000)).toMatchObject({ accepted: false, state: s });
  });
  test('same pixels on a later generation cannot accept an earlier plan ACK', () => {
    let s = displayed(initialState('screen'), news());
    const oldId = s.current!.planId;
    s = prepared(s, news(), T + 46 * MINUTE);
    expect(s.pending!.id).not.toBe(oldId);
    expect(acknowledge(s, { deviceId: 'screen', planId: oldId, sha256: F.sha256,
      result: 'refreshed' }, T + 46 * MINUTE + 2).accepted).toBe(false);
  });
  test('clock regression cannot select or confirm', () => {
    const s = prepared(initialState('screen'), news());
    expect(choose(s, [], T - 1, P)).toMatchObject({ reason: 'clock-regression' });
    expect(() => acknowledge(s, { deviceId: 'screen', planId: s.pending!.id, sha256: F.sha256,
      result: 'refreshed' }, T - 1)).toThrow('Clock regression');
  });
  test('input state/candidates/policy are not mutated', () => {
    const s = initialState('screen'), c = news();
    const before = JSON.stringify([s, c, P]);
    displayed(s, c);
    expect(JSON.stringify([s, c, P])).toBe(before);
  });
  test('ambiguous duplicate candidate keys fail closed', () => {
    expect(() => choose(initialState('screen'), [news(), news()], T, P)).toThrow('multiple versions');
  });
  test.each(['__proto__', 'constructor', '', 'bad\nkey'])('rejects unsafe key %s', key => {
    expect(() => validateCandidate(news(key))).toThrow();
  });
  test('bounded history pruning keeps current cooldown evidence', () => {
    const s = displayed(initialState('screen'), news());
    s.lastBySource.old = T - 49 * 60 * MINUTE;
    const next = pruneExposureHistory(s, T + MINUTE);
    expect(next.lastBySource.old).toBeUndefined();
    expect(next.lastByExposure['news:a']).toBe(T + 2);
  });
});

describe('governor explicit opt-in configuration', () => {
  test('empty config enrolls no production device', () => expect(configuredGovernorDevices({})).toEqual([]));
  test('allowlist is trimmed and deduplicated', () => {
    expect(configuredGovernorDevices({ QUOTE0_DISPLAY_GOVERNOR_DEVICES: 'eink-2, eink-4,eink-2' })).toEqual(['eink-2','eink-4']);
  });
  test.each(['*', 'eink-2,', '../screen', 'a\nb'])('invalid allowlist %s fails closed', value => {
    expect(() => configuredGovernorDevices({ QUOTE0_DISPLAY_GOVERNOR_DEVICES: value })).toThrow();
  });
  test('invalid cooldown/dwell combination is rejected', () => {
    expect(() => displayGovernorPolicy({ QUOTE0_DISPLAY_MIN_DWELL_MINUTES: '60' })).toThrow('Cooldown');
  });
  test.each(['0','NaN','-1','1.5','1441'])('invalid setting %s rejected', value => {
    expect(() => displayGovernorPolicy({ QUOTE0_DISPLAY_NEWS_COOLDOWN_MINUTES: value })).toThrow();
  });
  test('default policy has finite validated limits', () => expect(() => validatePolicy(displayGovernorPolicy({}))).not.toThrow());
});

test('six-hour mixed news/weather replay maintains per-device dwell and cooldown', () => {
  let state = initialState('simulated-screen');
  const last = new Map<string, number>();
  const events: { key: string; kind: string; at: number }[] = [];
  let weatherCount = 0;
  for (let tick = 0; tick < 6 * 60 * MINUTE; tick += 5000) {
    const now = T + tick;
    const candidates: Candidate[] = [news('solidot-old', { eligibleFromMs: T - 7 * 60 * MINUTE })];
    for (let index = 0; index < 36; index++) {
      candidates.push(news(`news:${index}`, { source: `source:${index % 3}`,
        eligibleFromMs: T - 60 * MINUTE + index * 10 * MINUTE }));
    }
    const observation = T + Math.floor(tick / (30 * MINUTE)) * 30 * MINUTE;
    candidates.push(weather({ eligibleFromMs: observation, expiresAtMs: observation + 120 * MINUTE }));
    const transition = reserve(state, candidates, now, P);
    state = transition.state;
    if (transition.decision.kind !== 'select') continue;
    const c = transition.decision.candidate;
    if (state.current) expect(now).toBeGreaterThanOrEqual(state.current.protectedUntilMs);
    state = publish(state, state.pending!.id, F, now + 1, P);
    state = acknowledge(state, { deviceId: state.deviceId, planId: state.pending!.id,
      sha256: F.sha256, result: 'refreshed' }, now + 2).state;
    const previous = last.get(c.exposureKey);
    if (previous !== undefined) expect(now + 2 - previous).toBeGreaterThanOrEqual(P.rules[c.kind].repeatCooldownMs);
    last.set(c.exposureKey, now + 2);
    if (c.kind === 'weather') weatherCount++;
    events.push({ key: c.key, kind: c.kind, at: now + 2 });
  }
  expect(weatherCount).toBeGreaterThanOrEqual(8);
  expect(events.some(event => event.key === 'solidot-old')).toBe(true);
  expect(events.length).toBeGreaterThan(100);
}, 30_000);
