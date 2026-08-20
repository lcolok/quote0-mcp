import {
  AlertTriangle,
  Binary,
  Check,
  CheckCircle2,
  Equal,
  Eye,
  Gauge,
  Image as ImageIcon,
  MonitorUp,
  Route,
  ShieldCheck,
  ShieldX,
  Sparkles,
} from 'lucide-react';

export interface RendererReviewDraft {
  choice: 'primary' | 'candidate' | 'tie' | null;
  informationRetention: number;
  readability: number;
  spaceUsage: number;
  physicalConfidence: number;
  note: string;
}

function percent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function ms(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(value >= 100 ? 0 : 1)} ms`;
}

function targetLabel(target: any): string {
  if (target?.physical?.widthMm && target?.physical?.heightMm) {
    return `${target.physical.widthMm}×${target.physical.heightMm} mm`;
  }
  return `${target?.widthPx ?? '?'}×${target?.heightPx ?? '?'} px`;
}

function imageSrc(image: any): string | undefined {
  const base64 = image?.base64;
  const mimeType = image?.mimeType || 'image/png';
  return typeof base64 === 'string' && base64 ? `data:${mimeType};base64,${base64}` : undefined;
}

function lifecycleLabel(value: string | undefined): string {
  if (value === 'authoritative') return 'AUTHORITATIVE';
  if (value === 'canary') return 'CANARY';
  if (value === 'experimental') return 'EXPERIMENTAL';
  if (value === 'reference') return 'REFERENCE';
  return value?.toUpperCase() || '—';
}

function SideCard({
  label,
  accent,
  side,
  target,
  badge,
}: {
  label: string;
  accent: string;
  side: any;
  target: any;
  badge?: string;
}) {
  const physical = side?.physicalPreview;
  const src = imageSrc(physical?.image || side?.image);
  const nativeWidth = Number(target?.widthPx) || 1;
  const nativeHeight = Number(target?.heightPx) || 1;
  const pixelPlan = side?.renderMetrics?.pixelSnapPlan;

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-1)] shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3.5 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">{label}</p>
            <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2 py-0.5 text-[9px] font-semibold tracking-[0.08em] text-[var(--text-muted)]">
              {lifecycleLabel(side?.lifecycle)}
            </span>
            {badge && (
              <span className="rounded-full border border-[color-mix(in_oklab,var(--agent)_25%,var(--border-subtle))] bg-[var(--agent-soft)] px-2 py-0.5 text-[9px] font-semibold tracking-[0.08em] text-[var(--agent)]">
                {badge}
              </span>
            )}
          </div>
          <p className={`mt-0.5 truncate text-sm font-semibold ${accent}`} title={side?.renderer || ''}>{side?.renderer || 'renderer'}</p>
        </div>
        <div className="text-right text-[11px] text-[var(--text-muted)]">
          <div>{targetLabel(target)}</div>
          <div>{side?.image?.bytes ? `${side.image.bytes.toLocaleString()} B PNG` : 'PNG'}</div>
        </div>
      </div>

      <div className="overflow-auto bg-white p-3">
        {src ? (
          <div className="mx-auto w-fit min-w-fit">
            <img
              src={src}
              alt={`${label} physical 1-bit preview`}
              width={nativeWidth}
              height={nativeHeight}
              data-native-pixel-preview="true"
              className="block max-w-none"
              style={{
                width: `${nativeWidth}px`,
                height: `${nativeHeight}px`,
                imageRendering: 'pixelated',
              }}
            />
          </div>
        ) : (
          <div className="grid h-40 place-items-center text-[var(--text-muted)]"><ImageIcon className="size-8" /></div>
        )}
      </div>

      {physical && (
        <div className={`border-t px-3 py-2 text-[10px] leading-4 ${physical.pointToPoint
          ? 'border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-muted)]'
          : 'border-[color-mix(in_oklab,var(--warning)_25%,var(--border-subtle))] bg-[var(--warning-soft)] text-[var(--warning)]'}`}>
          <p className="font-semibold">
            Physical 1-bit · {physical.pointToPoint ? 'POINT-TO-POINT' : 'RESIZED'} · 1× source pixels
          </p>
          <p>
            {physical.sourceSize?.width}×{physical.sourceSize?.height} → {physical.targetSize?.width}×{physical.targetSize?.height}
            {' · '}{physical.planeBytes?.toLocaleString?.() ?? physical.planeBytes} B
            {' · '}plane {String(physical.planeSha256 || '').slice(0, 12)}
          </p>
        </div>
      )}

      <div className="border-t border-[var(--border-subtle)] bg-[var(--surface-2)] p-3 text-xs">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-[var(--surface-1)] px-2.5 py-2">
            <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Render</p>
            <p className="mt-1 font-semibold text-[var(--text-primary)]">{ms(side?.renderMetrics?.totalMs)}</p>
          </div>
          <div className="rounded-xl bg-[var(--surface-1)] px-2.5 py-2">
            <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Black coverage</p>
            <p className="mt-1 font-semibold text-[var(--text-primary)]">{percent(side?.bitmapMetrics?.burnRatio)}</p>
          </div>
        </div>

        {pixelPlan ? (
          <div className="mt-2 rounded-xl bg-[var(--surface-1)] px-2.5 py-2 text-[10px] leading-4 text-[var(--text-muted)]">
            <p className="font-semibold text-[var(--text-secondary)]">TRMNL layout → Fusion Pixel raster</p>
            <p>
              点阵字号 {pixelPlan.typography?.title?.fontPx ?? '—'} / {pixelPlan.typography?.body?.fontPx ?? '—'} / {pixelPlan.typography?.footer?.fontPx ?? '—'}px
              {' · '}区块 {pixelPlan.regions?.title?.height ?? '—'} / {pixelPlan.regions?.body?.height ?? '—'} / {pixelPlan.regions?.footer?.height ?? '—'}px
            </p>
            <p>layout {ms(side.renderMetrics.layoutMeasureMs)} · raster {ms(side.renderMetrics.rasterMs)} · {side.renderMetrics.assetSource || 'asset source —'}</p>
          </div>
        ) : side?.renderMetrics?.recipeVersion ? (
          <div className="mt-2 rounded-xl bg-[var(--surface-1)] px-2.5 py-2 text-[10px] leading-4 text-[var(--text-muted)]">
            <p className="font-semibold text-[var(--text-secondary)]">{side.renderMetrics.recipeVersion}</p>
            <p>
              浏览器字号 {side.renderMetrics.typography?.titleFontPx?.toFixed?.(1) ?? '—'} / {side.renderMetrics.typography?.bodyFontPx?.toFixed?.(1) ?? '—'} / {side.renderMetrics.typography?.footerFontPx?.toFixed?.(1) ?? '—'}px
              {' · '}区块 {side.renderMetrics.regions?.title?.height?.toFixed?.(0) ?? '—'} / {side.renderMetrics.regions?.body?.height?.toFixed?.(0) ?? '—'} / {side.renderMetrics.regions?.footer?.height?.toFixed?.(0) ?? '—'}px
            </p>
            <p>{side.renderMetrics.pageReused ? 'warm page' : 'cold page'} · {side.renderMetrics.assetSource || 'asset source —'} · Framework {ms(side.renderMetrics.frameworkLoadMs)} · terminalize {ms(side.renderMetrics.terminalizeMs)}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DiffCard({ label, diff, target }: { label: string; diff: any; target: any }) {
  const src = imageSrc(diff?.image);
  const nativeWidth = Number(target?.widthPx) || 1;
  const nativeHeight = Number(target?.heightPx) || 1;
  const regionText = Object.entries(diff?.regions || {})
    .map(([name, value]: [string, any]) => `${name} ${value.changedPixels}`)
    .join(' · ');

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">{label}</p>
          <p className={`mt-0.5 text-xs font-semibold ${diff?.exact ? 'text-[var(--success)]' : 'text-[var(--warning)]'}`}>
            {diff?.exact ? '0 changed pixels · BIT-EXACT' : `${diff?.changedPixels?.toLocaleString?.() ?? '—'} changed · ${percent(diff?.changedRatio)}`}
          </p>
        </div>
        {diff?.bounds && (
          <span className="text-[10px] text-[var(--text-muted)]">bbox {diff.bounds.minX},{diff.bounds.minY} → {diff.bounds.maxX},{diff.bounds.maxY}</span>
        )}
      </div>
      {!diff?.exact && src && (
        <div className="overflow-auto bg-white p-3">
          <div className="mx-auto w-fit min-w-fit">
            <img
              src={src}
              alt={`${label} XOR diff`}
              width={nativeWidth}
              height={nativeHeight}
              className="block max-w-none"
              style={{ width: `${nativeWidth}px`, height: `${nativeHeight}px`, imageRendering: 'pixelated' }}
            />
          </div>
        </div>
      )}
      <div className="border-t border-[var(--border-subtle)] px-3 py-2 text-[10px] leading-4 text-[var(--text-muted)]">
        {regionText || 'No region deltas'}
      </div>
    </div>
  );
}

export function RendererComparisonView({
  data,
  targets,
  targetId,
  onTargetChange,
  isLoading,
  error,
}: {
  data: any;
  targets: any[];
  targetId: string;
  onTargetChange: (targetId: string) => void;
  isLoading: boolean;
  error: Error | null;
}) {
  const target = data?.target || targets.find((item) => item.id === targetId);
  const comparison = data?.comparison;
  const tracks = data?.governance?.tracks || [];
  const selfCheck = data?.selfCheck;
  const physicalPass = selfCheck?.physicalCandidate?.status === 'pass';
  const titleBar = selfCheck?.physicalCandidate?.titleBar;
  const titleBarPass = titleBar?.status === 'pass';
  const browserRejected = selfCheck?.browserProbe?.status === 'rejected';

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[color-mix(in_oklab,var(--agent)_20%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--agent)_4%,var(--surface-1))] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--agent-soft)] text-[var(--agent)]"><Route className="size-4" /></span>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">Renderer 物理 A/B</p>
              <p className="text-xs leading-5 text-[var(--text-secondary)]">A 是 Current/Satori；B 现在是可实际送入 1-bit 物理链路的 TRMNL Pixel Bridge。TRMNL Browser 只负责 Responsive / Clamp / Content Limiter 的布局测量，原始抗锯齿 PNG 已降级为诊断探针，不再冒充物理候选。</p>
            </div>
          </div>
          <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-muted)]">仍不改变真实推屏</span>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {tracks.map((track: any) => (
            <div key={track.id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-semibold text-[var(--text-primary)]">{track.id}</span>
                <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">{track.lifecycle}</span>
              </div>
              <p className="mt-1 truncate text-[10px] font-medium text-[var(--text-secondary)]" title={track.renderer}>{track.renderer}</p>
              <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-[var(--text-muted)]">{track.summary}</p>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {targets.map((item) => {
            const active = item.id === targetId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTargetChange(item.id)}
                aria-pressed={active}
                className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${active
                  ? 'border-[var(--brand-strong)] bg-[var(--brand-soft)] text-[var(--brand-strong)]'
                  : 'border-[var(--border-subtle)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)]'}`}
              >
                {targetLabel(item)}
              </button>
            );
          })}
        </div>
      </div>

      {isLoading && (
        <div className="grid min-h-52 place-items-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-2)] text-sm text-[var(--text-muted)]">
          <div className="text-center">
            <div className="mx-auto mb-3 size-7 animate-spin rounded-full border-2 border-[var(--border-subtle)] border-t-[var(--brand-strong)]" />
            正在渲染、转换并逐像素 XOR…
            <p className="mt-1 text-[11px]">自检会区分原生尺寸、最终位平面和 Browser 抗锯齿栅格。</p>
          </div>
        </div>
      )}

      {error && !isLoading && (
        <div className="rounded-2xl border border-[color-mix(in_oklab,var(--danger)_25%,var(--border-subtle))] bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger)]">
          Renderer A/B 渲染失败：{error.message}
        </div>
      )}

      {data && !isLoading && (
        <>
          <div className={`rounded-2xl border p-4 ${physicalPass
            ? 'border-[color-mix(in_oklab,var(--success)_28%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--success)_6%,var(--surface-1))]'
            : 'border-[color-mix(in_oklab,var(--danger)_30%,var(--border-subtle))] bg-[var(--danger-soft)]'}`}>
            <div className="flex items-start gap-3">
              <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${physicalPass ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--danger-soft)] text-[var(--danger)]'}`}>
                {physicalPass ? <CheckCircle2 className="size-4" /> : <ShieldX className="size-4" />}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--text-primary)]">物理候选自检：{physicalPass ? 'PASS' : 'FAIL'}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                  B {selfCheck?.physicalCandidate?.pointToPoint ? '原生尺寸、无 resize' : '发生尺寸转换'}；A ↔ B {selfCheck?.physicalCandidate?.exactVsPrimary
                    ? '最终位平面逐 bit 相同'
                    : `有 ${selfCheck?.physicalCandidate?.changedPixels?.toLocaleString?.() ?? '—'} 个像素差异（${percent(selfCheck?.physicalCandidate?.changedRatio)}）`}。
                </p>
                {titleBar && (
                  <p className={`mt-1 text-xs leading-5 ${titleBarPass ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                    标题黑条：{titleBarPass ? 'PASS' : 'FAIL'} · 实际 {titleBar.titleHeight}px / 内容需要 {titleBar.requiredHeight}px
                    {' · '}{titleBar.occupiedTitleLines} 行标题
                    {titleBar.excessRows > 0 ? ` · 多余纯黑 ${titleBar.excessRows}px` : ''}
                    {titleBar.clippedRows > 0 ? ` · 裁切风险 ${titleBar.clippedRows}px` : ''}。
                  </p>
                )}
                {browserRejected && (
                  <p className="mt-1 flex items-start gap-1.5 text-xs leading-5 text-[var(--warning)]">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    Browser 原始栅格已被自检拒绝：与物理 B 相差 {selfCheck.browserProbe.changedPixels.toLocaleString()} px（{percent(selfCheck.browserProbe.changedRatio)}），不参与 A/B 投票。
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <SideCard
              label={data.primary?.baselineRole === 'legacy-projection' ? 'A · Legacy projection' : 'A · Current / Satori'}
              accent="text-[var(--text-primary)]"
              side={data.primary}
              target={target}
            />
            <SideCard
              label="B · TRMNL Pixel Bridge"
              accent="text-[var(--agent)]"
              side={data.candidate}
              target={target}
              badge="PHYSICAL CANDIDATE"
            />
          </div>

          <DiffCard label="A ↔ B final 1-bit XOR" diff={data.diffs?.candidateVsPrimary} target={target} />

          <details open className="rounded-2xl border border-[color-mix(in_oklab,var(--warning)_22%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--warning)_4%,var(--surface-1))] p-3">
            <summary className="cursor-pointer list-none">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--warning-soft)] text-[var(--warning)]"><Eye className="size-4" /></span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--warning)]">TRMNL Browser Raster · 诊断探针</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">它仍负责产出 DOM region、padding、Clamp 后文本和字号测量，但 Browser PNG 的抗锯齿 / fractional raster 不再作为物理候选。</p>
                  </div>
                </div>
                <span className="rounded-full border border-[color-mix(in_oklab,var(--warning)_30%,var(--border-subtle))] bg-[var(--warning-soft)] px-2 py-1 text-[10px] font-semibold text-[var(--warning)]">EXCLUDED FROM A/B</span>
              </div>
            </summary>
            <div className="mt-3 grid gap-3 xl:grid-cols-2">
              <SideCard label="Layout probe · Browser PNG" accent="text-[var(--warning)]" side={data.browserProbe} target={target} badge="DIAGNOSTIC ONLY" />
              <DiffCard label="Browser ↔ physical B XOR" diff={data.diffs?.browserVsCandidate} target={target} />
            </div>
          </details>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]"><Gauge className="size-3.5" /> End-to-end Δ</div>
              <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{ms(comparison?.renderMsDelta)}</p>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]"><MonitorUp className="size-3.5" /> Black Δ</div>
              <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{comparison?.blackRatioDelta === undefined ? '—' : `${(comparison.blackRatioDelta * 100).toFixed(1)} pp`}</p>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]"><Binary className="size-3.5" /> XOR changed</div>
              <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{comparison?.changedPixels?.toLocaleString?.() ?? '—'} px</p>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]"><ShieldCheck className="size-3.5" /> Promotion</div>
              <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">≥ {data?.governance?.promotionGate?.minHumanReviews ?? 30} reviews</p>
            </div>
          </div>

          {data.primary?.baselineRole === 'legacy-projection' && (
            <div className="rounded-xl border border-[color-mix(in_oklab,var(--warning)_25%,var(--border-subtle))] bg-[var(--warning-soft)] px-3 py-2 text-xs leading-5 text-[var(--warning)]">
              热敏尺寸的 A 侧仍是旧新闻 renderer 的尺寸投影，不是现有热敏标签业务模板；这里主要比较 TRMNL 的跨尺寸表现。
            </div>
          )}

          {data.reference && (
            <details className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
              <summary className="cursor-pointer text-xs font-semibold text-[var(--text-primary)]">Adaptive v2 reference（冻结，不参与主 A/B）</summary>
              <p className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">保留它只用于迁移回归和像素 diff；后续不再把它发展成第三套 renderer/layout 体系。</p>
              <div className="mt-3 max-w-2xl">
                <SideCard label="Reference · Adaptive v2" accent="text-[var(--text-secondary)]" side={data.reference} target={target} />
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function ScoreRow({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-[var(--text-secondary)]">{label}</span>
        <span className="font-semibold text-[var(--text-primary)]">{value}/5</span>
      </div>
      <div className="grid grid-cols-5 gap-1">
        {[1, 2, 3, 4, 5].map((score) => (
          <button
            key={score}
            type="button"
            onClick={() => onChange(score)}
            className={`min-h-9 rounded-lg border text-xs font-semibold transition-colors ${score === value
              ? 'border-[var(--brand-strong)] bg-[var(--brand-soft)] text-[var(--brand-strong)]'
              : 'border-[var(--border-subtle)] bg-[var(--surface-1)] text-[var(--text-muted)] hover:bg-[var(--surface-2)]'}`}
          >{score}</button>
        ))}
      </div>
    </div>
  );
}

export function RendererReviewActions({
  draft,
  onChange,
  onSubmit,
  isSaving,
  existingReview,
}: {
  draft: RendererReviewDraft;
  onChange: (next: RendererReviewDraft) => void;
  onSubmit: () => void;
  isSaving: boolean;
  existingReview?: any;
}) {
  const choices = [
    { id: 'primary' as const, label: 'A · Current / Satori', icon: Check },
    { id: 'candidate' as const, label: 'B · TRMNL Pixel Bridge', icon: Sparkles },
    { id: 'tie' as const, label: '差不多', icon: Equal },
  ];

  return (
    <div className="space-y-4 rounded-2xl border border-[color-mix(in_oklab,var(--agent)_20%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--agent)_4%,var(--surface-1))] p-4">
      <div>
        <p className="text-sm font-semibold text-[var(--text-primary)]">Renderer A/B 评审</p>
        <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">主实验现在只比较 Current 与通过位平面自检的 TRMNL Pixel Bridge。Browser PNG 仅用于诊断布局，不可被投票选中。</p>
      </div>
      <div className="grid gap-2">
        {choices.map(({ id, label, icon: Icon }) => {
          const active = draft.choice === id;
          return (
            <button key={id} type="button" onClick={() => onChange({ ...draft, choice: id })} aria-pressed={active}
              className={`flex min-h-12 items-center gap-3 rounded-xl border px-3 text-left text-sm font-semibold transition-colors ${active
                ? 'border-[var(--agent)] bg-[var(--agent-soft)] text-[var(--agent)]'
                : 'border-[var(--border-subtle)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)]'}`}>
              <Icon className="size-4" />{label}
            </button>
          );
        })}
      </div>
      <div className="space-y-3 border-t border-[var(--border-subtle)] pt-3">
        <ScoreRow label="信息保留" value={draft.informationRetention} onChange={(value) => onChange({ ...draft, informationRetention: value })} />
        <ScoreRow label="字体 / 阅读" value={draft.readability} onChange={(value) => onChange({ ...draft, readability: value })} />
        <ScoreRow label="空间利用" value={draft.spaceUsage} onChange={(value) => onChange({ ...draft, spaceUsage: value })} />
        <ScoreRow label="真机信心" value={draft.physicalConfidence} onChange={(value) => onChange({ ...draft, physicalConfidence: value })} />
      </div>
      <textarea value={draft.note} onChange={(event) => onChange({ ...draft, note: event.target.value })} rows={3}
        placeholder="可选：TRMNL 换行、Clamp/Fit、极小尺寸、字体、裁切、信息损失…"
        className="w-full resize-y rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--agent)]" />
      <button type="button" onClick={onSubmit} disabled={!draft.choice || isSaving}
        className="min-h-11 w-full rounded-xl bg-[var(--agent)] px-4 text-sm font-semibold text-white shadow-sm transition-[opacity,transform] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transform-none">
        {isSaving ? '保存中…' : existingReview ? '更新 Renderer 评审' : '保存 Renderer 评审'}
      </button>
      {existingReview?.updated_at && <p className="text-center text-[11px] text-[var(--text-muted)]">已保存 · {new Date(existingReview.updated_at).toLocaleString('zh-CN')}</p>}
    </div>
  );
}
