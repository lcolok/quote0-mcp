export function resolveSchedulerExtraRenderers(
  raw: string | undefined,
  jobRole: string | undefined,
): { renderers: string[]; ignored: string[] } {
  const configured = [...new Set(
    (raw || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )];

  // Phase 1 之后 producer 只负责 content_inventory；local-eink 的唯一物理发送正门是
  // consumer → device_deliveries → delivery worker。继续 fire-and-forget local-eink 会造成
  // 同一内容直推一次、delivery 再推一次，并可能与 weather/memo 直推并发撞板端单缓冲。
  if (jobRole === 'producer') {
    const ignored = configured.filter((renderer) => renderer === 'local-eink');
    return {
      renderers: configured.filter((renderer) => renderer !== 'local-eink'),
      ignored,
    };
  }

  return { renderers: configured, ignored: [] };
}
