import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  FlaskConical,
  Scale,
  Sparkles,
} from 'lucide-react';
import {
  neuromancerReviewApi,
  type NeuromancerReviewScores,
} from '../api/neuromancer-review';

type BlindChoice = 'a' | 'b' | 'tie';

type Draft = {
  choice: BlindChoice | null;
  sideA: Partial<NeuromancerReviewScores>;
  sideB: Partial<NeuromancerReviewScores>;
  note: string;
};

const EMPTY_DRAFT: Draft = { choice: null, sideA: {}, sideB: {}, note: '' };

const dimensions: Array<{ key: keyof NeuromancerReviewScores; label: string; hint: string }> = [
  { key: 'factualConfidence', label: '事实信心', hint: '陈述是否可信、克制且没有明显过度推断' },
  { key: 'informationDensity', label: '信息密度', hint: '有限篇幅里是否保留了真正有价值的信息' },
  { key: 'einkSuitability', label: '墨水屏适配', hint: '标题和正文是否适合快速扫读与小屏展示' },
];

function completeScores(scores: Partial<NeuromancerReviewScores>): scores is NeuromancerReviewScores {
  return dimensions.every(({ key }) => Number.isInteger(scores[key]) && Number(scores[key]) >= 1 && Number(scores[key]) <= 5);
}

function ScoreRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-[var(--text-primary)]">{label}</p>
          <p className="text-[10px] leading-4 text-[var(--text-muted)]">{hint}</p>
        </div>
        <span className="text-xs font-semibold text-[var(--text-secondary)]">{value ?? '—'}/5</span>
      </div>
      <div className="grid grid-cols-5 gap-1">
        {[1, 2, 3, 4, 5].map((score) => (
          <button
            key={score}
            type="button"
            aria-pressed={value === score}
            onClick={() => onChange(score)}
            className={`min-h-9 rounded-lg border text-xs font-semibold transition-colors ${value === score
              ? 'border-[var(--brand-strong)] bg-[var(--brand-soft)] text-[var(--brand-strong)]'
              : 'border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:bg-[var(--surface-3)]'}`}
          >
            {score}
          </button>
        ))}
      </div>
    </div>
  );
}

function BlindSideCard({
  side,
  artifact,
  scores,
  onScore,
}: {
  side: 'A' | 'B';
  artifact: any;
  scores: Partial<NeuromancerReviewScores>;
  onScore: (key: keyof NeuromancerReviewScores, value: number) => void;
}) {
  return (
    <section data-testid={`blind-side-${side.toLowerCase()}`} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4 shadow-[var(--shadow-soft)] sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-xl bg-[var(--surface-3)] text-sm font-bold text-[var(--text-primary)]">{side}</span>
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">候选 {side}</p>
            <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Blind · identity hidden</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3.5">
        <p className="text-base font-semibold leading-6 text-[var(--text-primary)]">{artifact?.title || '—'}</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--text-secondary)]">{artifact?.message || '—'}</p>
      </div>

      <div className="mt-4 space-y-3">
        {dimensions.map(({ key, label, hint }) => (
          <ScoreRow
            key={key}
            label={label}
            hint={hint}
            value={scores[key]}
            onChange={(value) => onScore(key, value)}
          />
        ))}
      </div>
    </section>
  );
}

function RevealPanel({ pair, onWorthCost, isSavingCost }: { pair: any; onWorthCost: (value: boolean) => void; isSavingCost: boolean }) {
  const reveal = pair?.reveal;
  const review = pair?.review;
  if (!reveal || !review) return null;
  const receipt = reveal.researchReceipt || {};
  const sources = Array.isArray(receipt.sources) ? receipt.sources : [];
  const claims = Array.isArray(receipt.claims) ? receipt.claims : [];
  const researchSide = String(reveal.researchSide || '').toUpperCase();
  const directSide = researchSide === 'A' ? 'B' : 'A';

  return (
    <section className="rounded-2xl border border-[color-mix(in_oklab,var(--agent)_25%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--agent)_4%,var(--surface-1))] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--agent-soft)] text-[var(--agent)]"><Sparkles className="size-4" /></span>
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">已揭盲</p>
            <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
              {researchSide} = 神经漫游者 Research；{directSide} = 现有 Direct/AX。数据库保存的是 semantic winner，不依赖 A/B 展示顺序。
            </p>
          </div>
        </div>
        <span className="rounded-full bg-[var(--agent-soft)] px-2.5 py-1 text-[10px] font-semibold text-[var(--agent)]">
          选择 · {review.choice === 'research' ? 'Research' : review.choice === 'direct' ? 'Direct' : 'Tie'}
        </span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">Direct / AX</p>
          <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">{reveal.direct?.title}</p>
          <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{reveal.direct?.message || reveal.direct?.summary}</p>
          {reveal.direct?.signature && <p className="mt-2 text-[10px] text-[var(--text-muted)]">产出者 · {reveal.direct.signature}</p>}
        </div>
        <div className="rounded-xl border border-[color-mix(in_oklab,var(--agent)_22%,var(--border-subtle))] bg-[var(--surface-1)] p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--agent)]">Neuromancer Research</p>
          <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">{reveal.research?.title}</p>
          <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{reveal.research?.message}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-[var(--text-muted)]">
            <span>{sources.length} sources</span>
            <span>{claims.length} claims</span>
            {reveal.runtimeReceipt?.toolCalls !== undefined && <span>{reveal.runtimeReceipt.toolCalls} tools</span>}
            {reveal.straylightThreadId && (
              <a
                href={`https://profilmai.logic.heiyu.space/c/${reveal.straylightThreadId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-[var(--agent)] hover:underline"
              >
                Straylight <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        </div>
      </div>

      {(sources.length > 0 || claims.length > 0) && (
        <details className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
          <summary className="cursor-pointer text-xs font-semibold text-[var(--text-primary)]">查看 Research Receipt 证据</summary>
          <div className="mt-3 space-y-2">
            {sources.map((source: any) => (
              <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer" className="block rounded-lg bg-[var(--surface-1)] px-2.5 py-2 text-xs hover:underline">
                <span className="font-semibold text-[var(--text-primary)]">{source.role} · {source.title || source.id}</span>
                <span className="mt-0.5 block truncate text-[var(--text-muted)]">{source.url}</span>
              </a>
            ))}
            {claims.map((claim: any, index: number) => (
              <div key={`${claim.text}-${index}`} className="rounded-lg bg-[var(--surface-1)] px-2.5 py-2 text-xs leading-5 text-[var(--text-secondary)]">
                {claim.text}
                <span className="ml-2 rounded bg-[var(--agent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--agent)]">{claim.status}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="mt-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3.5">
        <p className="text-xs font-semibold text-[var(--text-primary)]">看完证据后：这次 Research 的增益值得额外运行成本吗？</p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            disabled={isSavingCost}
            onClick={() => onWorthCost(true)}
            className={`rounded-lg border px-3 py-2 text-xs font-semibold ${review.researchWorthCost === true ? 'border-[var(--success)] bg-[var(--success-soft)] text-[var(--success)]' : 'border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-secondary)]'}`}
          >
            值得
          </button>
          <button
            type="button"
            disabled={isSavingCost}
            onClick={() => onWorthCost(false)}
            className={`rounded-lg border px-3 py-2 text-xs font-semibold ${review.researchWorthCost === false ? 'border-[var(--warning)] bg-[var(--warning-soft)] text-[var(--warning)]' : 'border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-secondary)]'}`}
          >
            不值得
          </button>
        </div>
      </div>
    </section>
  );
}

export default function NeuromancerReviewPage() {
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  const candidatesQuery = useQuery({
    queryKey: ['neuromancer-review-candidates'],
    queryFn: () => neuromancerReviewApi.candidates({ limit: 80 }),
    staleTime: 15_000,
  });
  const candidates = candidatesQuery.data?.data || [];

  useEffect(() => {
    if (!selectedRunId && candidates.length > 0) {
      const first = candidates.find((candidate: any) => !candidate.reviewed) || candidates[0];
      setSelectedRunId(first.runId);
    }
  }, [candidates, selectedRunId]);

  const detailQuery = useQuery({
    queryKey: ['neuromancer-review-pair', selectedRunId],
    queryFn: () => neuromancerReviewApi.get(selectedRunId!),
    enabled: Boolean(selectedRunId),
  });
  const pair = detailQuery.data?.data;

  useEffect(() => {
    if (!pair) return;
    if (!pair.review || !pair.reveal) {
      setDraft(EMPTY_DRAFT);
      return;
    }
    const researchIsA = pair.reveal.researchSide === 'a';
    const directScores = pair.review.directScores;
    const researchScores = pair.review.researchScores;
    const semanticChoice = pair.review.choice;
    const blindChoice: BlindChoice = semanticChoice === 'tie'
      ? 'tie'
      : semanticChoice === 'research'
        ? pair.reveal.researchSide
        : (researchIsA ? 'b' : 'a');
    setDraft({
      choice: blindChoice,
      sideA: researchIsA ? researchScores : directScores,
      sideB: researchIsA ? directScores : researchScores,
      note: pair.review.note || '',
    });
  }, [pair?.runId, pair?.review?.updatedAt]);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!selectedRunId || !draft.choice || !completeScores(draft.sideA) || !completeScores(draft.sideB)) {
        throw new Error('请先完成 A/B 选择以及两侧全部 1–5 分评分');
      }
      return neuromancerReviewApi.saveReview(selectedRunId, {
        choice: draft.choice,
        sideA: draft.sideA,
        sideB: draft.sideB,
        note: draft.note,
      });
    },
    onSuccess: (payload) => {
      queryClient.setQueryData(['neuromancer-review-pair', selectedRunId], payload);
      queryClient.invalidateQueries({ queryKey: ['neuromancer-review-candidates'] });
      toast.success('盲测已保存，现在揭示哪一侧来自神经漫游者');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const costMutation = useMutation({
    mutationFn: (worthCost: boolean) => neuromancerReviewApi.saveWorthCost(selectedRunId!, worthCost),
    onSuccess: (payload) => {
      queryClient.setQueryData(['neuromancer-review-pair', selectedRunId], payload);
      toast.success('Research 成本评价已保存');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const pendingCount = useMemo(() => candidates.filter((candidate: any) => !candidate.reviewed).length, [candidates]);
  const nextUnreviewed = candidates.find((candidate: any) => !candidate.reviewed && candidate.runId !== selectedRunId);
  const readyToSave = Boolean(draft.choice && completeScores(draft.sideA) && completeScores(draft.sideB));

  return (
    <div className="min-h-[calc(100dvh-8rem)] space-y-4">
      <header className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4 shadow-[var(--shadow-soft)] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Link to="/annotate" className="grid size-9 shrink-0 place-items-center rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:bg-[var(--surface-3)]" aria-label="返回内容标注">
              <ArrowLeft className="size-4" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <FlaskConical className="size-4 text-[var(--agent)]" />
                <h1 className="text-lg font-semibold text-[var(--text-primary)]">神经漫游者 · 内容增益盲测</h1>
              </div>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--text-secondary)]">
                同一条 content inventory 的 Direct/AX 成品与 Neuromancer Research 成品随机放在 A/B。提交偏好和双侧评分前不显示产出者、Research Receipt 或工具过程；提交后才揭盲。
              </p>
            </div>
          </div>
          <div className="flex gap-2 text-xs">
            <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 font-medium text-[var(--text-secondary)]">{candidates.length} pairs</span>
            <span className="rounded-full bg-[var(--agent-soft)] px-2.5 py-1 font-medium text-[var(--agent)]">{pendingCount} 待评</span>
          </div>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="max-h-[calc(100dvh-13rem)] overflow-y-auto rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-1)] p-2 shadow-[var(--shadow-soft)]">
          {candidatesQuery.isLoading && <p className="p-4 text-sm text-[var(--text-muted)]">正在加载 Research 成品…</p>}
          {!candidatesQuery.isLoading && candidates.length === 0 && <p className="p-4 text-sm text-[var(--text-muted)]">暂无已完成且可比较的 Neuromancer Research 成品。</p>}
          <div className="space-y-1">
            {candidates.map((candidate: any) => {
              const selected = candidate.runId === selectedRunId;
              return (
                <button
                  key={candidate.runId}
                  type="button"
                  onClick={() => setSelectedRunId(candidate.runId)}
                  className={`w-full rounded-xl border p-3 text-left transition-colors ${selected ? 'border-[var(--brand-strong)] bg-[var(--brand-soft)]' : 'border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--surface-2)]'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="line-clamp-2 text-xs font-semibold leading-5 text-[var(--text-primary)]">{candidate.subjectTitle}</p>
                    {candidate.reviewed ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-[var(--success)]" /> : <span className="mt-1 size-2 shrink-0 rounded-full bg-[var(--agent)]" />}
                  </div>
                  <p className="mt-1 text-[10px] text-[var(--text-muted)]">inventory #{candidate.sourceInventoryId}</p>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="space-y-4">
          {detailQuery.isLoading && <div className="grid min-h-72 place-items-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-1)] text-sm text-[var(--text-muted)]">正在构建盲测 pair…</div>}
          {detailQuery.error && <div className="rounded-2xl border border-[var(--danger)] bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger)]">{(detailQuery.error as Error).message}</div>}
          {pair && (
            <>
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">共同研究主体</p>
                    <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{pair.subject?.title}</p>
                    {pair.subject?.source && <p className="mt-1 text-xs text-[var(--text-muted)]">Seed source · {pair.subject.source}</p>}
                  </div>
                  <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2.5 py-1 text-[10px] font-semibold text-[var(--text-muted)]">不改变真实推屏</span>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <BlindSideCard side="A" artifact={pair.sideA} scores={draft.sideA} onScore={(key, value) => setDraft((current) => ({ ...current, sideA: { ...current.sideA, [key]: value } }))} />
                <BlindSideCard side="B" artifact={pair.sideB} scores={draft.sideB} onScore={(key, value) => setDraft((current) => ({ ...current, sideB: { ...current.sideB, [key]: value } }))} />
              </div>

              <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4 sm:p-5">
                <div className="flex items-center gap-2">
                  <Scale className="size-4 text-[var(--brand-strong)]" />
                  <p className="text-sm font-semibold text-[var(--text-primary)]">只看内容，你更希望 Quote0 保留哪一版？</p>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {(['a', 'b', 'tie'] as const).map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      aria-pressed={draft.choice === choice}
                      onClick={() => setDraft((current) => ({ ...current, choice }))}
                      className={`min-h-11 rounded-xl border px-3 text-sm font-semibold transition-colors ${draft.choice === choice ? 'border-[var(--brand-strong)] bg-[var(--brand-soft)] text-[var(--brand-strong)]' : 'border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:bg-[var(--surface-3)]'}`}
                    >
                      {choice === 'a' ? '选 A' : choice === 'b' ? '选 B' : '差不多'}
                    </button>
                  ))}
                </div>
                <textarea
                  value={draft.note}
                  onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
                  placeholder="可选：记录为什么更喜欢这一版…"
                  maxLength={2000}
                  className="mt-3 min-h-20 w-full resize-y rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--brand-strong)]"
                />
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  {nextUnreviewed && (
                    <button type="button" onClick={() => setSelectedRunId(nextUnreviewed.runId)} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 text-xs font-semibold text-[var(--text-secondary)]">
                      下一条未评 <ArrowRight className="size-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={!readyToSave || saveMutation.isPending}
                    onClick={() => saveMutation.mutate()}
                    className="min-h-10 rounded-xl bg-[var(--brand-strong)] px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {saveMutation.isPending ? '保存中…' : pair.review ? '更新盲测并重新揭示' : '提交盲测并揭示身份'}
                  </button>
                </div>
              </section>

              <RevealPanel pair={pair} onWorthCost={(value) => costMutation.mutate(value)} isSavingCost={costMutation.isPending} />
            </>
          )}
        </main>
      </div>
    </div>
  );
}
