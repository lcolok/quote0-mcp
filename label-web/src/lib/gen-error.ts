/**
 * 把后端原始生成错误翻成给人看的友好文案。
 * 上游(如 BizyAir)错误常 opaque(例: "task failed: Ok"),无法可靠区分版权/内容限制,
 * 故用覆盖式提示,既提版权/内容可能,也提服务繁忙可重试。
 */
export function friendlyGenError(raw?: string | null): { title: string; hint: string } {
  const e = raw ?? '';
  if (/timeout|abort|timed out|超时/i.test(e))
    return { title: '生成超时', hint: '图像服务响应超时,请稍后重试。' };
  if (/HTTP 4\d\d/i.test(e))
    return { title: '请求被拒绝', hint: '描述可能触及内容或版权限制,调整描述后重试。' };
  if (/HTTP 5\d\d|task failed/i.test(e))
    return { title: '生成失败', hint: '图像服务处理失败,可能是描述触及内容/版权限制,或服务繁忙。可调整描述或稍后重试。' };
  if (/无 urls|无 url|无图/i.test(e))
    return { title: '未返回图像', hint: '图像服务未产出结果,请重试或调整描述。' };
  return { title: '生成失败', hint: '请重试,或调整描述后再生成。' };
}
