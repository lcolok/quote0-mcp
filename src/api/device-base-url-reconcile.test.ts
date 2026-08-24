import { describe, expect, it } from 'bun:test';
import { isPrivateIpv4, reconcileBaseUrl, reconcileDeviceBaseUrl } from './device-base-url-reconcile.js';

describe('isPrivateIpv4', () => {
  it('accepts RFC1918', () => {
    expect(isPrivateIpv4('192.168.31.87')).toBe(true);
    expect(isPrivateIpv4('10.0.0.1')).toBe(true);
    expect(isPrivateIpv4('172.16.0.1')).toBe(true);
    expect(isPrivateIpv4('172.31.255.254')).toBe(true);
  });
  it('rejects public / malformed / v6', () => {
    expect(isPrivateIpv4('8.8.8.8')).toBe(false);
    expect(isPrivateIpv4('172.32.0.1')).toBe(false);
    expect(isPrivateIpv4('192.168.1')).toBe(false);
    expect(isPrivateIpv4('192.168.1.256')).toBe(false);
    expect(isPrivateIpv4('::1')).toBe(false);
    expect(isPrivateIpv4('evil.host')).toBe(false);
  });
});

describe('reconcileBaseUrl', () => {
  it('replaces host only, keeps scheme/port/path', () => {
    expect(reconcileBaseUrl('http://192.168.31.89:80', '192.168.31.87')).toBe('http://192.168.31.87:80');
    expect(reconcileBaseUrl('http://192.168.31.89:8080/api', '192.168.31.87')).toBe('http://192.168.31.87:8080/api');
  });
  it('no-op when unchanged, missing, or not private', () => {
    expect(reconcileBaseUrl('http://192.168.31.87:80', '192.168.31.87')).toBeNull();
    expect(reconcileBaseUrl('http://192.168.31.87:80', undefined)).toBeNull();
    expect(reconcileBaseUrl('http://192.168.31.87:80', '')).toBeNull();
    expect(reconcileBaseUrl('http://192.168.31.87:80', '113.207.49.188')).toBeNull();
  });
  it('never overrides a non-IPv4 hostname (mDNS / domain) or unparsable base_url', () => {
    expect(reconcileBaseUrl('http://eink-4.local:80', '192.168.31.87')).toBeNull();
    expect(reconcileBaseUrl('https://dot.mindreset.tech/api', '192.168.31.87')).toBeNull();
    expect(reconcileBaseUrl('not a url', '192.168.31.87')).toBeNull();
  });
});

describe('reconcileDeviceBaseUrl', () => {
  it('writes only on change and logs', async () => {
    const calls: any[] = []; const logs: string[] = [];
    const deps = { updatePushDevice: async (id: string, p: any) => { calls.push([id, p]); return {}; }, log: (m: string) => logs.push(m) };
    const r = await reconcileDeviceBaseUrl(deps, { id: 'eink-4', base_url: 'http://192.168.31.89:80' }, '192.168.31.87');
    expect(r).toBe('http://192.168.31.87:80');
    expect(calls).toEqual([['eink-4', { base_url: 'http://192.168.31.87:80' }]]);
    expect(logs[0]).toContain('自愈');
    const r2 = await reconcileDeviceBaseUrl(deps, { id: 'eink-4', base_url: 'http://192.168.31.87:80' }, '192.168.31.87');
    expect(r2).toBeNull();
    expect(calls.length).toBe(1);
  });
  it('swallows DB errors', async () => {
    const logs: string[] = [];
    const deps = { updatePushDevice: async () => { throw new Error('pg down'); }, log: (m: string) => logs.push(m) };
    const r = await reconcileDeviceBaseUrl(deps, { id: 'eink-4', base_url: 'http://192.168.31.89:80' }, '192.168.31.87');
    expect(r).toBeNull();
    expect(logs[0]).toContain('写库失败');
  });
});
