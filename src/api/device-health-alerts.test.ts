import { describe, expect, it, mock } from 'bun:test';
import {
  classifyDeviceHealthTransition,
  formatDeviceHealthAlert,
  isBarkAlertsConfigured,
  sendBarkDeviceAlert,
} from './device-health-alerts.js';

describe('device health alert transition semantics', () => {
  it('只通知恶化和完全恢复，不为同态/中间改善制造噪声', () => {
    expect(classifyDeviceHealthTransition('healthy', 'degraded')).toEqual({ kind: 'warning', level: 'warning' });
    expect(classifyDeviceHealthTransition('degraded', 'offline')).toEqual({ kind: 'critical', level: 'critical' });
    expect(classifyDeviceHealthTransition('healthy', 'misconfigured')).toEqual({ kind: 'critical', level: 'critical' });
    expect(classifyDeviceHealthTransition('offline', 'healthy')).toEqual({ kind: 'recovery', level: 'info' });
    expect(classifyDeviceHealthTransition('misconfigured', 'healthy')).toEqual({ kind: 'recovery', level: 'info' });
    expect(classifyDeviceHealthTransition('degraded', 'healthy')).toEqual({ kind: 'recovery', level: 'info' });

    expect(classifyDeviceHealthTransition('healthy', 'healthy')).toBeNull();
    expect(classifyDeviceHealthTransition('offline', 'degraded')).toBeNull();
    expect(classifyDeviceHealthTransition('offline', 'misconfigured')).toBeNull();
    expect(classifyDeviceHealthTransition('unknown', 'healthy')).toBeNull();
  });

  it('告警正文只含诊断上下文，不含 secret', () => {
    const alert = formatDeviceHealthAlert({
      deviceId: 'eink-2',
      fromHealth: 'healthy',
      toHealth: 'offline',
      errorCode: 'timeout',
      consecutiveFailures: 5,
    });
    expect(alert).toMatchObject({ kind: 'critical', level: 'critical' });
    expect(alert?.body).toContain('device=eink-2');
    expect(alert?.body).toContain('healthy→offline');
    expect(alert?.body).toContain('code=timeout');
    expect(alert?.body).toContain('failures=5');
  });
});

describe('Bark sender', () => {
  const baseEnv = {
    BARK_ALERTS_ENABLED: 'true',
    BARK_DEVICE_KEY: 'test-device-key',
    BARK_BASE: 'https://bark.example.test',
    BARK_GROUP: 'quote0-test',
  } as NodeJS.ProcessEnv;

  it('placeholder/disabled 均视为未配置', () => {
    expect(isBarkAlertsConfigured({ BARK_DEVICE_KEY: '<set-via-lazycat-console>' })).toBe(false);
    expect(isBarkAlertsConfigured({ BARK_DEVICE_KEY: 'abc', BARK_ALERTS_ENABLED: 'false' })).toBe(false);
    expect(isBarkAlertsConfigured(baseEnv)).toBe(true);
  });

  it('critical 用 POST form 且明确 level/volume；HTTP 非 2xx 抛错', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = mock(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ code: 200 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    await sendBarkDeviceAlert({
      device_id: 'eink-2',
      from_health: 'degraded',
      to_health: 'offline',
      alert_kind: 'critical',
      level: 'critical',
      error_code: 'timeout',
      consecutive_failures: 5,
    }, { env: baseEnv, fetchFn });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://bark.example.test/test-device-key');
    expect(calls[0].init.method).toBe('POST');
    const form = new URLSearchParams(String(calls[0].init.body));
    expect(form.get('group')).toBe('quote0-test');
    expect(form.get('level')).toBe('critical');
    expect(form.get('volume')).toBe('5');
    expect(form.get('body')).toContain('device=eink-2');

    const badFetch = mock(async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
    await expect(sendBarkDeviceAlert({
      device_id: 'eink-2',
      from_health: 'healthy',
      to_health: 'degraded',
      alert_kind: 'warning',
      level: 'warning',
      error_code: 'connection',
      consecutive_failures: 3,
    }, { env: baseEnv, fetchFn: badFetch })).rejects.toThrow('Bark HTTP 503');
  });

  it('Bark JSON code 非 200 即使 HTTP 200 也视为失败', async () => {
    const fetchFn = mock(async () => new Response(JSON.stringify({ code: 400 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
    await expect(sendBarkDeviceAlert({
      device_id: 'eink-2',
      from_health: 'degraded',
      to_health: 'healthy',
      alert_kind: 'recovery',
      level: 'info',
      error_code: 'timeout',
      consecutive_failures: 3,
    }, { env: baseEnv, fetchFn })).rejects.toThrow('Bark response code 400');
  });
});
