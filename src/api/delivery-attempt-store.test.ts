import { describe, expect, it } from 'bun:test';
import { deliveryAttemptTraceId, pushResultEvidence } from './delivery-attempt-store.js';

describe('delivery attempt evidence helpers', () => {
  it('trace id 与 claim 后的 attempt_no 一一对应', () => {
    expect(deliveryAttemptTraceId('18466', 1)).toBe('d18466-a1');
    expect(deliveryAttemptTraceId('18466', 3)).toBe('d18466-a3');
  });

  it('显式区分 request 与 ACK 证据，避免旧兼容字段掩盖 ACK 缺失', () => {
    const evidence = pushResultEvidence({
      ok: true,
      traceId: 'd10-a2',
      crc32: 'AAAABBBB',
      requestTraceId: 'd10-a2',
      requestCrc32: 'aaaabbbb',
      bodyBytes: 5640,
      ackTraceId: 'd10-a2',
      ackCrc32: 'AAAABBBB',
    });

    expect(evidence).toEqual({
      traceId: 'd10-a2',
      requestCrc32: 'aaaabbbb',
      bodyBytes: 5640,
      ackTraceId: 'd10-a2',
      ackCrc32: 'AAAABBBB',
      deviceError: undefined,
    });
  });

  it('旧固件兼容成功时 ACK 可为空，不能伪造为真实 ACK', () => {
    const evidence = pushResultEvidence({
      ok: true,
      traceId: 'legacy-trace',
      crc32: '12345678',
      requestTraceId: 'legacy-trace',
      requestCrc32: '12345678',
      bodyBytes: 5640,
    });

    expect(evidence.traceId).toBe('legacy-trace');
    expect(evidence.requestCrc32).toBe('12345678');
    expect(evidence.ackTraceId).toBeUndefined();
    expect(evidence.ackCrc32).toBeUndefined();
  });
});
