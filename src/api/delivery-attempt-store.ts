import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import type { EinkPushResult, EinkStatus } from './eink-converter.js';
export type DeliveryAttemptOutcome = 'started' | 'succeeded' | 'retry_wait' | 'dead';

export interface DeliveryAttemptEvidence {
  deliveryId: string;
  attemptNo: number;
  deviceId: string;
  workerId?: string;
  wireProtocol?: string;
  firmware?: string;
  protocolDiag?: number;
  /** attempt 的稳定关联 ID；即使在 HTTP 前失败也保留，body_bytes/CRC 可判断是否走到发送阶段。 */
  traceId?: string;
  requestCrc32?: string;
  bodyBytes?: number;
  ackTraceId?: string;
  ackCrc32?: string;
  statusSnapshot?: EinkStatus;
  deviceError?: unknown;
  outcome?: DeliveryAttemptOutcome;
  /** push 错误码或 server-side `payload_error`。DB 为 TEXT，保留可扩展性。 */
  errorCode?: string;
  errorText?: string;
  finished?: boolean;
}

/** 与 worker 生产 trace 的唯一规则。attemptNo 是 claim 后已递增的 attempts。 */
export function deliveryAttemptTraceId(deliveryId: string, attemptNo: number): string {
  return `d${deliveryId}-a${attemptNo}`;
}

function toJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ serialization_error: true });
  }
}

/**
 * attempt ledger 是诊断旁路，绝不能改变物理投递的成功/失败语义。
 * 同一个 (delivery_id, attempt_no) 可以分阶段补齐字段：started → push evidence → terminal。
 */
export async function recordDeliveryAttemptEvidence(evidence: DeliveryAttemptEvidence): Promise<void> {
  const statusJson = toJson(evidence.statusSnapshot);
  const deviceErrorJson = toJson(evidence.deviceError);
  const outcome = evidence.outcome ?? 'started';

  await getPostgresDatabase().getPool().query(
    `INSERT INTO device_delivery_attempts (
       delivery_id, attempt_no, device_id, worker_id,
       wire_protocol, firmware, protocol_diag,
       trace_id, request_crc32, body_bytes,
       ack_trace_id, ack_crc32,
       status_snapshot, device_error,
       outcome, error_code, error_text, finished_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
       $13::jsonb,$14::jsonb,$15,$16,$17,
       CASE WHEN $18::boolean THEN now() ELSE NULL END, now()
     )
     ON CONFLICT (delivery_id, attempt_no) DO UPDATE SET
       worker_id        = COALESCE(EXCLUDED.worker_id, device_delivery_attempts.worker_id),
       wire_protocol    = COALESCE(EXCLUDED.wire_protocol, device_delivery_attempts.wire_protocol),
       firmware         = COALESCE(EXCLUDED.firmware, device_delivery_attempts.firmware),
       protocol_diag    = COALESCE(EXCLUDED.protocol_diag, device_delivery_attempts.protocol_diag),
       trace_id         = COALESCE(EXCLUDED.trace_id, device_delivery_attempts.trace_id),
       request_crc32    = COALESCE(EXCLUDED.request_crc32, device_delivery_attempts.request_crc32),
       body_bytes       = COALESCE(EXCLUDED.body_bytes, device_delivery_attempts.body_bytes),
       ack_trace_id     = COALESCE(EXCLUDED.ack_trace_id, device_delivery_attempts.ack_trace_id),
       ack_crc32        = COALESCE(EXCLUDED.ack_crc32, device_delivery_attempts.ack_crc32),
       status_snapshot  = COALESCE(EXCLUDED.status_snapshot, device_delivery_attempts.status_snapshot),
       device_error     = COALESCE(EXCLUDED.device_error, device_delivery_attempts.device_error),
       outcome          = EXCLUDED.outcome,
       error_code       = COALESCE(EXCLUDED.error_code, device_delivery_attempts.error_code),
       error_text       = COALESCE(EXCLUDED.error_text, device_delivery_attempts.error_text),
       finished_at      = COALESCE(EXCLUDED.finished_at, device_delivery_attempts.finished_at),
       updated_at       = now()`,
    [
      evidence.deliveryId,
      evidence.attemptNo,
      evidence.deviceId,
      evidence.workerId ?? null,
      evidence.wireProtocol ?? null,
      evidence.firmware ?? null,
      evidence.protocolDiag ?? null,
      evidence.traceId ?? null,
      evidence.requestCrc32 ?? null,
      evidence.bodyBytes ?? null,
      evidence.ackTraceId ?? null,
      evidence.ackCrc32 ?? null,
      statusJson,
      deviceErrorJson,
      outcome,
      evidence.errorCode ?? null,
      evidence.errorText?.slice(0, 2000) ?? null,
      evidence.finished === true,
    ],
  );
}

export async function recordDeliveryAttemptEvidenceBestEffort(
  evidence: DeliveryAttemptEvidence,
): Promise<void> {
  try {
    await recordDeliveryAttemptEvidence(evidence);
  } catch (error) {
    console.warn(
      `⚠️ delivery attempt 诊断证据写入失败: delivery=${evidence.deliveryId} attempt=${evidence.attemptNo}`,
      error instanceof Error ? error.message : error,
    );
  }
}

export function pushResultEvidence(result: EinkPushResult | undefined): Pick<
  DeliveryAttemptEvidence,
  'traceId' | 'requestCrc32' | 'bodyBytes' | 'ackTraceId' | 'ackCrc32' | 'deviceError'
> {
  if (!result) return {};
  return {
    traceId: result.requestTraceId,
    requestCrc32: result.requestCrc32,
    bodyBytes: result.bodyBytes,
    ackTraceId: result.ackTraceId,
    ackCrc32: result.ackCrc32,
    deviceError: result.deviceError,
  };
}
