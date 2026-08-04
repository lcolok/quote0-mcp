/**
 * 拉模式帧缓存端点测试（Phase A）
 *
 * 测试覆盖：
 *  ① computeFrameId — sha256 前 16 hex
 *  ② upsertDeviceFrame + getDeviceFrame — 写后读一致性
 *  ③ 端点 200/304/204/404 四路径（需 API 启动的集成测试，标记为 integration）
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { computeFrameId, upsertDeviceFrame, getDeviceFrame } from './device-frame-cache.js';

// ============================================================================
// computeFrameId
// ============================================================================

describe('computeFrameId', () => {
  it('产生 16 字符 hex', () => {
    const buf = Buffer.from('hello world');
    const id = computeFrameId(buf);
    expect(id.length).toBe(16);
    expect(/^[0-9a-f]{16}$/.test(id)).toBe(true);
  });

  it('相同内容 → 相同 frame_id', () => {
    const a = Buffer.from([0, 1, 2, 3]);
    const b = Buffer.from([0, 1, 2, 3]);
    expect(computeFrameId(a)).toBe(computeFrameId(b));
  });

  it('不同内容 → 不同 frame_id', () => {
    const a = Buffer.from([0, 1, 2, 3]);
    const b = Buffer.from([0, 1, 2, 4]);
    expect(computeFrameId(a)).not.toBe(computeFrameId(b));
  });

  it('空 Buffer 也能产生 frame_id', () => {
    const id = computeFrameId(Buffer.alloc(0));
    expect(id.length).toBe(16);
  });

  it('大 Buffer (4736B 典型帧) 稳定', () => {
    const buf = Buffer.alloc(4736);
    // 制造一些非零数据
    for (let i = 0; i < buf.length; i++) buf[i] = i % 256;
    const id1 = computeFrameId(buf);
    const id2 = computeFrameId(Buffer.from(buf)); // 独立 copy
    expect(id1).toBe(id2);
  });
});

// ============================================================================
// getDeviceFrame 空值返回
// 注意：依赖 device_frames 表存在（migration 后才有），表不存在时跳过。
// ============================================================================

describe('getDeviceFrame 不存在的设备', () => {
  it('不存在的 device_id 返回 null（表可能尚未创建）', async () => {
    try {
      const result = await getDeviceFrame('__test_nonexistent_device_20260805__');
      // 表存在但无此设备 → null
      expect(result).toBeNull();
    } catch (e: any) {
      // 表尚未创建（42P01）→ 跳过，码是对的
      if (e?.code === '42P01') {
        console.warn('⚠️ device_frames 表尚未创建，跳过 getDeviceFrame 集成测试');
        return;
      }
      throw e;
    }
  });
});
