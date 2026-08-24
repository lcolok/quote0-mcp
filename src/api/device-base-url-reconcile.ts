// device-base-url-reconcile.ts — 设备心跳自报 LAN 地址 → 自愈 push_devices.base_url
//
// 背景：eink-local 设备靠 DHCP，IP 会漂（同一块 S3 板 08-15 是 .89，08-24 变 .87），push 链按 DB 里的
// base_url 投递，漂了就静默失联。设备的云 pull 每 2s 自带 device_id + token 鉴权，顺手带 X-Local-IP，
// 服务端在鉴权通过后对账：host 不同才写库，其余情况零写入。
//
// 安全边界：只接受 RFC1918 IPv4（10/8、172.16/12、192.168/16）；只替换 host，scheme/port/path 原样保留；
// 调用方必须在设备 token 校验通过之后才调用本函数。

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function isPrivateIpv4(ip: string): boolean {
  const m = IPV4_RE.exec(ip.trim());
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n < 0 || n > 255)) return false;
  if (o[0] === 10) return true;
  if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
  if (o[0] === 192 && o[1] === 168) return true;
  return false;
}

/**
 * 纯函数：给定当前 base_url 与设备自报 IP，返回应写入的新 base_url；无需变更返回 null。
 * - reportedIp 非私网 IPv4 → null（不采信）
 * - base_url 解析失败 → null（不猜）
 * - base_url 的 hostname 不是 IPv4 字面量（如 mDNS 名 / 域名）→ null（用户显式配置的名字不覆盖）
 * - host 相同 → null
 */
export function reconcileBaseUrl(currentBaseUrl: string, reportedIp: string | undefined | null): string | null {
  if (!reportedIp) return null;
  const ip = reportedIp.trim();
  if (!isPrivateIpv4(ip)) return null;
  // 不经 URL 序列化（它会吞默认端口 :80、补尾斜杠），只做 host 字面替换，其余字节原样保留
  const m = /^([a-z][a-z0-9+.-]*:\/\/)([^/:?#]+)(.*)$/i.exec(currentBaseUrl.trim());
  if (!m) return null;
  const host = m[2];
  if (!IPV4_RE.test(host)) return null;
  if (host === ip) return null;
  return `${m[1]}${ip}${m[3]}`;
}

export interface ReconcileDeps {
  updatePushDevice: (id: string, patch: Record<string, unknown>) => Promise<unknown>;
  log?: (msg: string) => void;
}

/** 副作用版：有变化才写库并打日志；写库失败只记日志，绝不影响取帧主流程。 */
export async function reconcileDeviceBaseUrl(
  deps: ReconcileDeps,
  device: { id: string; base_url: string },
  reportedIp: string | undefined | null,
): Promise<string | null> {
  const next = reconcileBaseUrl(device.base_url, reportedIp);
  if (!next) return null;
  try {
    await deps.updatePushDevice(device.id, { base_url: next });
    (deps.log ?? console.log)(`📡 设备 ${device.id} LAN 地址漂移已自愈: ${device.base_url} → ${next}`);
    return next;
  } catch (e: any) {
    (deps.log ?? console.log)(`⚠️ 设备 ${device.id} base_url 自愈写库失败（保持 ${device.base_url}）: ${e?.message ?? e}`);
    return null;
  }
}
