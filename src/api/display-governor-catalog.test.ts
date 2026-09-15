import { describe, expect, test } from 'bun:test';
import { inventoryCandidate, memoCatalogEntry, parseAmapObservationTime, weatherCatalogEntry,
  type InventoryRow } from './display-governor-catalog.js';
import { MINUTE } from './display-governor.js';
const now = Date.parse('2026-09-15T16:00:00+08:00');
const weather = { city: '广州', temperature: 30, humidity: 70, weather: '晴', updateTime: '2026-09-15 15:30:00' };

describe('governor catalog identity and freshness', () => {
  test('AMAP wall time is parsed explicitly as +08, never host timezone', () => {
    expect(parseAmapObservationTime(weather.updateTime)).toBe(Date.parse('2026-09-15T07:30:00Z'));
  });
  test.each([undefined, '', 'yesterday', '2026-09-15T15:30:00', '2026-02-30 12:00:00',
    '2026-09-15 24:00:00', '2026-13-15 12:00:00'])('rejects malformed observation %s', value => {
    expect(() => parseAmapObservationTime(value)).toThrow();
  });
  test('fetching unchanged old observations never renews expiry', () => {
    const first = weatherCatalogEntry('weather-guangzhou', weather, now);
    const second = weatherCatalogEntry('weather-guangzhou', weather, now + 10 * MINUTE);
    expect(second.candidate.expiresAtMs).toBe(first.candidate.expiresAtMs);
    expect(second.candidate.version).toBe(first.candidate.version);
    expect(second.candidate.exposureKey).toBe(first.candidate.exposureKey);
  });
  test('a new observation timestamp alone is not semantic novelty', () => {
    const first = weatherCatalogEntry('weather-guangzhou', weather, now);
    const second = weatherCatalogEntry('weather-guangzhou', { ...weather, updateTime: '2026-09-15 16:00:00' }, now);
    expect(second.candidate.version).toBe(first.candidate.version);
    expect(second.candidate.dataRef).not.toBe(first.candidate.dataRef);
  });
  test('new actual weather values change version but retain the same exposure stream', () => {
    const first = weatherCatalogEntry('weather-guangzhou', weather, now);
    const second = weatherCatalogEntry('weather-guangzhou', { ...weather, temperature: 31 }, now);
    expect(second.candidate.version).not.toBe(first.candidate.version);
    expect(second.candidate.exposureKey).toBe(first.candidate.exposureKey);
  });
  test('missing observation time cannot fall back to fetch time', () => {
    expect(() => weatherCatalogEntry('weather-guangzhou', { ...weather, updateTime: undefined }, now)).toThrow();
  });
  test('expired or materially future observations cannot be admitted', () => {
    expect(() => weatherCatalogEntry('weather-guangzhou', { ...weather, updateTime: '2026-09-15 12:00:00' }, now)).toThrow('expired');
    expect(() => weatherCatalogEntry('weather-guangzhou', { ...weather, updateTime: '2026-09-15 18:00:00' }, now)).toThrow('future');
  });
  test('non-finite observations are rejected', () => {
    expect(() => weatherCatalogEntry('weather-guangzhou', { ...weather, temperature: NaN }, now)).toThrow();
  });
  test('rerender or rewording changes snapshot, not article exposure identity', () => {
    const row: InventoryRow = { id: 123, fingerprint: 'stable-subject', title: 'title', source: 'solidot',
      link: 'https://example.invalid/story', raw_content: { title: 'original' },
      processed_content: { title: 'short title' }, created_ms: now, expires_ms: now + 24 * 60 * MINUTE };
    const first = inventoryCandidate(row);
    const second = inventoryCandidate({ ...row, processed_content: { title: 'different wording' } });
    expect(second.key).toBe(first.key);
    expect(second.exposureKey).toBe(first.exposureKey);
    expect(second.version).toBe(first.version);
    expect(second.dataRef).not.toBe(first.dataRef);
  });
  test('memo variants cannot reset stable memo identity', () => {
    const a = memoCatalogEntry('memo-job', 'abc', 'payload/a.png', 'a'.repeat(64), now);
    const b = memoCatalogEntry('memo-job', 'abc', 'payload/b.png', 'b'.repeat(64), now);
    expect(a.candidate.exposureKey).toBe(b.candidate.exposureKey);
    expect(a.candidate.version).not.toBe(b.candidate.version);
    expect(() => memoCatalogEntry('memo-job', 'abc', 'payload/a.png', 'invalid', now)).toThrow();
  });
});
