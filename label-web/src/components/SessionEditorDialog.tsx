import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  HelpCircle,
  Images,
  Loader2,
  Send,
  Sparkles,
  Sprout,
  X,
  Zap,
  ZoomIn,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import RefImageUploader from '@/components/RefImageUploader';
import { sessionsApi } from '@/api/sessions';
import type { PlanPath, PlanResponse, SessionTurn } from '@/types/session';
import type { BatchItem } from '@/types/batch';

const TRUST_KEY = 'label-session-trust-mode';

interface Props {
  items: BatchItem[];
  itemId: string | null;
  onClose: () => void;
  onNavigate: (itemId: string) => void;
}

/** 确认后回传给父组件的最终决定(parentTurnId = 选中路径的 fork 基准,可能 ≠ 聚焦版) */
interface ConfirmedPlan {
  parentTurnId: string | null;
  genMode: 'img2img' | 'rewrite';
  refImageUrls: string[];
  effectivePrompt: string;
  agentReply: string;
  reasoning: string | null;
}

function pickRecommended(paths: PlanPath[]): PlanPath {
  return paths.find((p) => p.recommended) ?? paths[0];
}

function TurnThumb({ turn }: { turn: SessionTurn }) {
  if (turn.state === 'pending' || turn.state === 'running')
    return <Loader2 className="h-4 w-4 animate-spin text-purple-500" />;
  if (turn.state === 'failed') return <AlertCircle className="h-4 w-4 text-destructive" />;
  if (turn.label?.pngUrl)
    return <img src={turn.label.pngUrl} alt="" className="h-full w-full object-contain" />;
  return <span className="text-[10px] text-muted-foreground">无图</span>;
}

/**
 * 分叉树:按 parent→child 布局(x=代次深度,y=DFS 顺序),SVG 连线。
 * 点节点 = 聚焦(预览 + 下一次生成的 fork 基准),不移动采用指针。
 */
function VersionTree({
  turns,
  adoptedId,
  focusedId,
  versionNo,
  onFocus,
}: {
  turns: SessionTurn[];
  adoptedId: string | null;
  focusedId: string | null;
  versionNo: (id: string) => number;
  onFocus: (id: string) => void;
}) {
  const COL = 96;
  const ROW = 60;
  const NW = 80;
  const NH = 46;
  const THUMB = 28;

  const byId = new Map(turns.map((t) => [t.id, t]));
  const childrenMap = new Map<string, SessionTurn[]>();
  const roots: SessionTurn[] = [];
  turns.forEach((t) => {
    if (t.parentTurnId && byId.has(t.parentTurnId)) {
      const arr = childrenMap.get(t.parentTurnId) ?? [];
      arr.push(t);
      childrenMap.set(t.parentTurnId, arr);
    } else {
      roots.push(t);
    }
  });

  const pos = new Map<string, { x: number; y: number }>();
  let yc = 0;
  const visit = (t: SessionTurn, depth: number) => {
    pos.set(t.id, { x: depth, y: yc++ });
    (childrenMap.get(t.id) ?? []).forEach((c) => visit(c, depth + 1));
  };
  roots.forEach((r) => visit(r, 0));

  const maxX = pos.size ? Math.max(...[...pos.values()].map((p) => p.x)) : 0;
  const W = (maxX + 1) * COL;
  const H = Math.max(1, yc) * ROW;

  return (
    <div className="overflow-auto" style={{ maxHeight: '12rem' }}>
      <div className="relative" style={{ width: W, height: H }}>
        <svg className="pointer-events-none absolute inset-0" width={W} height={H}>
          {turns.map((t) => {
            if (!t.parentTurnId || !pos.has(t.parentTurnId) || !pos.has(t.id)) return null;
            const p = pos.get(t.parentTurnId)!;
            const c = pos.get(t.id)!;
            const x1 = p.x * COL + NW;
            const y1 = p.y * ROW + NH / 2;
            const x2 = c.x * COL;
            const y2 = c.y * ROW + NH / 2;
            const mx = x1 + (x2 - x1) / 2;
            return (
              <path
                key={t.id}
                d={`M${x1},${y1} H${mx} V${y2} H${x2}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                className="text-muted-foreground/40"
              />
            );
          })}
        </svg>
        {turns.map((t) => {
          const p = pos.get(t.id);
          if (!p) return null;
          const adopted = t.id === adoptedId;
          const focused = t.id === focusedId;
          return (
            <button
              key={t.id}
              onClick={() => onFocus(t.id)}
              title={t.userFeedback ?? (t.turnKind === 'root' ? '初始版本' : '生成')}
              className={`absolute rounded-md border bg-background p-0.5 text-left transition ${
                focused ? 'ring-2 ring-blue-500' : 'hover:border-primary/50'
              } ${t.state === 'failed' ? 'border-destructive' : adopted ? 'border-primary' : ''}`}
              style={{ left: p.x * COL, top: p.y * ROW, width: NW }}
            >
              <div
                className="flex items-center justify-center overflow-hidden rounded bg-muted"
                style={{ height: THUMB }}
              >
                <TurnThumb turn={t} />
              </div>
              <div className="flex items-center justify-between px-0.5">
                <span className="text-[9px] text-muted-foreground">v{versionNo(t.id)}</span>
                {adopted && (
                  <span className="rounded bg-primary px-1 text-[8px] leading-tight text-primary-foreground">
                    采用
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Claude-Code 风格路径选择器:agent 给 2-3 条重生成路径(可能换 fork 基准以避免 GIGO),
 * 用户 ↑/↓ 选路径,展开后可微调模式/参考图/prompt,Enter 确认生成。
 */
function PathChooser({
  plan,
  versionNo,
  busy,
  onConfirm,
  onCancel,
  onZoom,
}: {
  plan: PlanResponse;
  versionNo: (turnId: string) => number;
  busy: boolean;
  onConfirm: (c: ConfirmedPlan) => void;
  onCancel: () => void;
  onZoom: (url: string) => void;
}) {
  const paths = plan.paths ?? [];
  const [pathId, setPathId] = useState<string>(() => pickRecommended(paths).id);
  const path = paths.find((p) => p.id === pathId) ?? paths[0];

  const [mode, setMode] = useState<'img2img' | 'rewrite'>(path.mode);
  const [sel, setSel] = useState<Set<string>>(
    () => new Set(path.candidateRefs.filter((c) => c.selected).map((c) => c.url))
  );
  const [prompt, setPrompt] = useState(path.prompt);

  // 切换路径 → 重置为该路径的默认 模式/参考图/prompt
  useEffect(() => {
    setMode(path.mode);
    setSel(new Set(path.candidateRefs.filter((c) => c.selected).map((c) => c.url)));
    setPrompt(path.prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathId]);

  const toggle = (url: string) =>
    setSel((prev) => {
      const n = new Set(prev);
      n.has(url) ? n.delete(url) : n.add(url);
      return n;
    });

  const confirm = () =>
    onConfirm({
      parentTurnId: path.baseTurnId,
      genMode: mode,
      refImageUrls: [...sel],
      effectivePrompt: prompt.trim(),
      agentReply: plan.reply,
      reasoning: plan.reasoning,
    });

  // 键盘:↑/↓ 切路径,Enter 确认,Esc 取消(textarea/input 聚焦时不抢)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const i = paths.findIndex((p) => p.id === pathId);
        const ni = e.key === 'ArrowDown' ? Math.min(paths.length - 1, i + 1) : Math.max(0, i - 1);
        setPathId(paths[ni].id);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (!busy) confirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, pathId, mode, sel, prompt]);

  return (
    <div className="space-y-2.5 rounded-lg border border-purple-300 bg-purple-50/60 p-2.5 dark:border-purple-800 dark:bg-purple-950/30">
      {/* agent 总览 */}
      <div className="flex items-start gap-1.5 text-xs">
        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-purple-500" />
        <div className="space-y-0.5">
          <div className="whitespace-pre-wrap">{plan.reply}</div>
          {plan.reasoning && (
            <div className="text-[10px] text-muted-foreground">{plan.reasoning}</div>
          )}
        </div>
      </div>

      {/* 路径选择(↑/↓) */}
      <div>
        <div className="mb-1 text-[10px] font-medium text-muted-foreground">
          选择重生成路径(↑/↓ 切换)
        </div>
        <div className="space-y-1.5">
          {paths.map((p) => {
            const on = p.id === pathId;
            const clean = p.strategy === 'clean-restart';
            return (
              <button
                key={p.id}
                onClick={() => setPathId(p.id)}
                className={`w-full rounded-md border px-2 py-1.5 text-left transition ${
                  on ? 'border-primary ring-1 ring-primary' : 'hover:border-primary/50'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs">
                  {clean ? (
                    <Sprout className="h-3.5 w-3.5 shrink-0 text-green-600" />
                  ) : (
                    <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="font-medium">{p.label}</span>
                  {p.recommended && (
                    <span className="rounded bg-green-600 px-1 text-[8px] text-white">推荐</span>
                  )}
                  <span className="ml-auto text-[9px] text-muted-foreground">
                    {p.strategy === 'fresh' || !p.baseTurnId
                      ? '全新起点·无继承'
                      : `基于 v${versionNo(p.baseTurnId) || p.baseVersionNo}`}{' '}
                    · {p.mode === 'img2img' ? '图生图' : '重写'}
                  </span>
                </div>
                {p.rationale && (
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{p.rationale}</div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 选中路径的微调:模式 / 参考图 / prompt */}
      <div className="space-y-2 rounded-md border bg-background/60 p-2">
        <div className="flex gap-1.5">
          {(['img2img', 'rewrite'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 rounded-md border px-2 py-1 text-xs transition ${
                mode === m
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'hover:border-primary/50'
              }`}
            >
              {m === 'img2img' ? '微调(图生图)' : '重写(文生图)'}
            </button>
          ))}
        </div>

        {path.candidateRefs.length > 0 && (
          <div>
            <div className="mb-1 text-[10px] font-medium text-muted-foreground">
              参考图(最小纯净上下文,可加/减)
            </div>
            <div className="flex flex-wrap gap-1.5">
              {path.candidateRefs.map((c) => {
                const on = sel.has(c.url);
                return (
                  <div key={c.url} className="group relative w-[68px]">
                    <div
                      role="button"
                      onClick={() => toggle(c.url)}
                      title={`${c.label}(点选/取消;🔍 放大)`}
                      className={`cursor-pointer rounded-md border p-0.5 transition ${
                        on ? 'border-primary ring-1 ring-primary' : 'opacity-50 hover:opacity-100'
                      }`}
                    >
                      <div className="flex h-10 items-center justify-center overflow-hidden rounded bg-muted">
                        <img src={c.url} alt={c.label} className="h-full w-full object-cover" />
                      </div>
                      <div className="mt-0.5 truncate text-[9px] text-muted-foreground">{c.label}</div>
                    </div>
                    {on && (
                      <span className="pointer-events-none absolute right-0.5 top-0.5 rounded-full bg-primary p-0.5 text-primary-foreground">
                        <Check className="h-2.5 w-2.5" />
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onZoom(c.url);
                      }}
                      title="放大查看"
                      className="absolute left-0.5 top-0.5 hidden rounded bg-black/60 p-0.5 group-hover:block"
                    >
                      <ZoomIn className="h-2.5 w-2.5 text-white" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <div className="mb-1 text-[10px] font-medium text-muted-foreground">
            {mode === 'rewrite' ? '重写后的 prompt(可编辑)' : '变更说明(可编辑)'}
          </div>
          <Textarea
            rows={mode === 'rewrite' ? 4 : 2}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="text-xs"
          />
        </div>
      </div>

      {/* 操作 */}
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={onCancel}>
          <X className="mr-1 h-3.5 w-3.5" />
          取消
        </Button>
        <Button
          size="sm"
          className="h-7 flex-1 text-xs"
          disabled={busy || !prompt.trim()}
          onClick={confirm}
        >
          {busy ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="mr-1 h-3.5 w-3.5" />
          )}
          确认生成
          {path.strategy === 'fresh' || !path.baseTurnId
            ? '(全新起点)'
            : `(基于 v${versionNo(path.baseTurnId) || path.baseVersionNo})`}
        </Button>
      </div>
      <div className="text-center text-[9px] text-muted-foreground">
        ↑/↓ 切路径 · Enter 确认 · Esc 取消
      </div>
    </div>
  );
}

/** clarify 模式:需求模糊时 agent 反问的确认面板(选项数量由 VLM 动态决定;也可自定义) */
function ClarifyChooser({
  plan,
  busy,
  onPick,
  onCancel,
}: {
  plan: PlanResponse;
  busy: boolean;
  onPick: (qa: string) => void;
  onCancel: () => void;
}) {
  const choices = plan.choices ?? [];
  const [choiceId, setChoiceId] = useState<string>(choices[0]?.id ?? '');
  const [custom, setCustom] = useState('');

  const submit = () => {
    const ch = choices.find((c) => c.id === choiceId);
    const answer = custom.trim() || ch?.label || '';
    if (!answer) return;
    onPick(`${plan.question ?? '需求确认'} → ${answer}`);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const i = choices.findIndex((c) => c.id === choiceId);
        const ni = e.key === 'ArrowDown' ? Math.min(choices.length - 1, i + 1) : Math.max(0, i - 1);
        setChoiceId(choices[ni]?.id ?? choiceId);
        setCustom('');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (!busy) submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, choiceId, custom, choices]);

  return (
    <div className="space-y-2.5 rounded-lg border border-amber-300 bg-amber-50/60 p-2.5 dark:border-amber-800 dark:bg-amber-950/30">
      <div className="flex items-start gap-1.5 text-xs">
        <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
        <div className="space-y-0.5">
          {plan.reply && <div className="whitespace-pre-wrap text-muted-foreground">{plan.reply}</div>}
          <div className="font-medium">{plan.question}</div>
        </div>
      </div>
      <div className="space-y-1.5">
        {choices.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              setChoiceId(c.id);
              setCustom('');
            }}
            className={`w-full rounded-md border px-2 py-1.5 text-left transition ${
              c.id === choiceId && !custom.trim()
                ? 'border-primary ring-1 ring-primary'
                : 'hover:border-primary/50'
            }`}
          >
            <div className="text-xs font-medium">{c.label}</div>
            {c.description && (
              <div className="mt-0.5 text-[10px] text-muted-foreground">{c.description}</div>
            )}
          </button>
        ))}
      </div>
      <input
        type="text"
        value={custom}
        onChange={(e) => setCustom(e.target.value)}
        placeholder="或自己输入答案…"
        className="w-full rounded-md border bg-background px-2 py-1 text-xs"
      />
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={onCancel}>
          <X className="mr-1 h-3.5 w-3.5" />
          取消
        </Button>
        <Button
          size="sm"
          className="h-7 flex-1 text-xs"
          disabled={busy || (!custom.trim() && !choiceId)}
          onClick={submit}
        >
          {busy ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="mr-1 h-3.5 w-3.5" />
          )}
          确认这个方向
        </Button>
      </div>
      <div className="text-center text-[9px] text-muted-foreground">
        ↑/↓ 选 · Enter 确认 · Esc 取消
      </div>
    </div>
  );
}

/** 参考图池:常驻画廊,列出整个 session 的所有图(输入/参考图 + 各版本产物),勾选 = 纳入下一轮上下文 */
function ReferencePool({
  turns,
  selected,
  onToggle,
  onZoom,
}: {
  turns: SessionTurn[];
  selected: Set<string>;
  onToggle: (url: string) => void;
  onZoom: (url: string) => void;
}) {
  const outSeen = new Set<string>();
  const outputs: { url: string; label: string }[] = [];
  turns.forEach((t, i) => {
    const s = t.label?.sourceImageUrl;
    if (s && !outSeen.has(s)) {
      outSeen.add(s);
      outputs.push({ url: s, label: `v${i + 1}` });
    }
  });
  const inSeen = new Set<string>();
  const inputs: { url: string; label: string }[] = [];
  turns.forEach((t, i) => {
    t.refImageUrls.forEach((u) => {
      if (u && !inSeen.has(u) && !outSeen.has(u)) {
        inSeen.add(u);
        inputs.push({ url: u, label: `v${i + 1} 输入` });
      }
    });
  });
  // 有输入参考图时默认展开(避免被折叠藏起来找不到)
  const [open, setOpen] = useState(inputs.length > 0);
  const total = inputs.length + outputs.length;
  if (total === 0) return null;

  const Item = ({ url, label }: { url: string; label: string }) => {
    const on = selected.has(url);
    return (
      <div className="group relative w-[56px] shrink-0">
        <div
          role="button"
          onClick={() => onToggle(url)}
          title={`${label}(点选/取消;🔍 放大)`}
          className={`cursor-pointer rounded border p-0.5 transition ${
            on ? 'border-primary ring-1 ring-primary' : 'opacity-60 hover:opacity-100'
          }`}
        >
          <div className="h-9 overflow-hidden rounded bg-muted">
            <img src={url} alt={label} className="h-full w-full object-cover" />
          </div>
          <div className="truncate text-[8px] text-muted-foreground">{label}</div>
        </div>
        {on && (
          <span className="pointer-events-none absolute right-0 top-0 rounded-bl bg-primary p-0.5">
            <Check className="h-2.5 w-2.5 text-primary-foreground" />
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onZoom(url);
          }}
          title="放大查看"
          className="absolute left-0 top-0 hidden rounded-br bg-black/60 p-0.5 group-hover:block"
        >
          <ZoomIn className="h-2.5 w-2.5 text-white" />
        </button>
      </div>
    );
  };

  return (
    <div className="rounded-md border">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 px-2 py-1 text-[10px] text-muted-foreground"
      >
        <Images className="h-3 w-3" />
        参考图池({total}){selected.size ? ` · 已选 ${selected.size}` : ''}
        <span className="ml-auto">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="max-h-40 space-y-2 overflow-y-auto border-t p-2">
          {inputs.length > 0 && (
            <div>
              <div className="mb-1 text-[9px] font-medium text-muted-foreground">
                🖼 输入/参考图(你提供的)
              </div>
              <div className="flex flex-wrap gap-1">
                {inputs.map((x) => (
                  <Item key={x.url} url={x.url} label={x.label} />
                ))}
              </div>
            </div>
          )}
          {outputs.length > 0 && (
            <div>
              <div className="mb-1 text-[9px] font-medium text-muted-foreground">各版本产物</div>
              <div className="flex flex-wrap gap-1">
                {outputs.map((x) => (
                  <Item key={x.url} url={x.url} label={x.label} />
                ))}
              </div>
            </div>
          )}
          <div className="text-[9px] text-muted-foreground">
            勾选 = 纳入下一轮上下文(一定会用) · 悬停 🔍 放大
          </div>
        </div>
      )}
    </div>
  );
}

export default function SessionEditorDialog({ items, itemId, onClose, onNavigate }: Props) {
  const qc = useQueryClient();
  const item = items.find((i) => i.id === itemId) ?? null;
  const idx = item ? items.findIndex((i) => i.id === item.id) : -1;

  const ensureQ = useQuery({
    queryKey: ['session-ensure', itemId],
    queryFn: () => sessionsApi.ensure(itemId!),
    enabled: !!itemId,
    staleTime: Infinity,
  });
  const sessionId = ensureQ.data?.sessionId ?? null;

  const treeQ = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => sessionsApi.get(sessionId!),
    enabled: !!sessionId,
    refetchInterval: (query) => {
      const turns = query.state.data?.turns;
      return turns?.some((t) => t.state === 'pending' || t.state === 'running') ? 2000 : false;
    },
  });

  const turns = treeQ.data?.turns ?? [];
  const currentTurnId = treeQ.data?.session.currentTurnId ?? null;
  // adopted = 当前采用版(batch 显示/打印);focused = 正在看/将基于它 fork 的版本
  const adopted = turns.find((t) => t.id === currentTurnId) ?? turns[turns.length - 1] ?? null;
  const versionNo = (id: string) => turns.findIndex((t) => t.id === id) + 1;

  const [feedback, setFeedback] = useState('');
  const [refUrls, setRefUrls] = useState<string[]>([]);
  const [pendingPlan, setPendingPlan] = useState<PlanResponse | null>(null);
  const [trustMode, setTrustMode] = useState(() => localStorage.getItem(TRUST_KEY) === '1');
  const [focusedTurnId, setFocusedTurnId] = useState<string | null>(null);
  // 参考图池里勾选的现有图(与上传框 refUrls 一起作为本轮 staged 上下文)
  const [poolSel, setPoolSel] = useState<Set<string>>(new Set());
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  // 已解决的澄清问答链(每次 clarify 选完追加),作为后续 /plan 的上下文
  const [clarifyTrail, setClarifyTrail] = useState<string[]>([]);
  const togglePool = (url: string) =>
    setPoolSel((prev) => {
      const n = new Set(prev);
      n.has(url) ? n.delete(url) : n.add(url);
      return n;
    });

  const focused = turns.find((t) => t.id === focusedTurnId) ?? adopted;

  const setTrust = (v: boolean) => {
    setTrustMode(v);
    localStorage.setItem(TRUST_KEY, v ? '1' : '0');
  };

  // 切换聚焦 item 时清空输入与待确认提案,聚焦交还给采用指针
  useEffect(() => {
    setFeedback('');
    setRefUrls([]);
    setPendingPlan(null);
    setFocusedTurnId(null);
    setPoolSel(new Set());
    setClarifyTrail([]);
  }, [itemId]);

  // 采用指针变化(生成新版自动成为当前 / 手动采用)→ 聚焦跟到它,这样能看到刚出的结果
  useEffect(() => {
    if (currentTurnId) setFocusedTurnId(currentTurnId);
  }, [currentTurnId]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['session', sessionId] });
    qc.invalidateQueries({ queryKey: ['batch'] });
  };

  const refineMut = useMutation({
    mutationFn: (cp: ConfirmedPlan) =>
      sessionsApi.refine(sessionId!, {
        parentTurnId: cp.parentTurnId,
        feedback: feedback.trim(),
        genMode: cp.genMode,
        refImageUrls: cp.refImageUrls.length ? cp.refImageUrls : undefined,
        effectivePrompt: cp.effectivePrompt || undefined,
        agentReply: cp.agentReply || undefined,
        plannerReasoning: cp.reasoning ?? undefined,
        clientRequestId: crypto.randomUUID(),
      }),
    onSuccess: () => {
      setFeedback('');
      setRefUrls([]);
      setPoolSel(new Set());
      setPendingPlan(null);
      setClarifyTrail([]);
      toast.success('已开始生成新版本');
      invalidate();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? '生成失败'),
  });

  // 规划:调 /plan 拿多条路径;信任模式直接走推荐路径,否则弹路径选择器
  const planMut = useMutation({
    mutationFn: (vars: { fresh: boolean; clarifications: string[] }) => {
      // 本轮 staged 上下文 = 上传框新图 + 参考图池勾选的现有图
      const staged = [...new Set([...refUrls, ...poolSel])];
      return sessionsApi.plan(sessionId!, {
        parentTurnId: focused?.id ?? null,
        feedback: feedback.trim(),
        refImageUrls: staged.length ? staged : undefined,
        fresh: vars.fresh,
        clarifications: vars.clarifications.length ? vars.clarifications : undefined,
      });
    },
    onSuccess: (plan) => {
      // 需求明确 → 路径;信任模式直接走推荐路径
      if (plan.kind === 'paths') {
        if (!plan.paths?.length) {
          toast.error('未能生成规划路径');
          return;
        }
        if (trustMode) {
          const p = pickRecommended(plan.paths);
          refineMut.mutate({
            parentTurnId: p.baseTurnId,
            genMode: p.mode,
            refImageUrls: p.candidateRefs.filter((c) => c.selected).map((c) => c.url),
            effectivePrompt: p.prompt,
            agentReply: plan.reply,
            reasoning: plan.reasoning,
          });
          return;
        }
      }
      // clarify(反问)或 非信任的 paths → 弹面板
      setPendingPlan(plan);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? '规划失败'),
  });

  const cancelPlan = () => {
    setPendingPlan(null);
    setClarifyTrail([]);
  };
  // 用户选了某个澄清方向 → 追加到 trail,带着它再跑一轮规划
  const onClarifyPick = (qa: string) => {
    const newTrail = [...clarifyTrail, qa];
    setClarifyTrail(newTrail);
    setPendingPlan(null);
    planMut.mutate({ fresh: false, clarifications: newTrail });
  };

  // 采用某版本作为当前(打印/显示用),移动指针但不生成
  const adoptMut = useMutation({
    mutationFn: (turnId: string) => sessionsApi.select(sessionId!, turnId),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e?.response?.data?.error ?? '采用失败'),
  });

  const busy = planMut.isPending || refineMut.isPending;
  const focusedIsAdopted = focused?.id === adopted?.id;

  // ←/→ 切换聚焦 item(输入框聚焦 / 确认面板打开时不抢按键)
  useEffect(() => {
    if (!itemId) return;
    const onKey = (e: KeyboardEvent) => {
      if (pendingPlan) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      if (e.key === 'ArrowLeft' && idx > 0) onNavigate(items[idx - 1].id);
      if (e.key === 'ArrowRight' && idx >= 0 && idx < items.length - 1) onNavigate(items[idx + 1].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [itemId, idx, items, onNavigate, pendingPlan]);

  return (
    <Dialog
      open={!!itemId}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-[96vw] w-[1180px] h-[88vh] flex flex-col p-0 gap-0 overflow-hidden">
        {/* 头部:item 聚焦切换(pr-14 给 DialogContent 自带的右上角关闭 X 留位,避免重叠) */}
        <div className="flex items-center gap-2 border-b py-2.5 pl-4 pr-14">
          <Button
            variant="ghost"
            size="sm"
            disabled={idx <= 0}
            onClick={() => onNavigate(items[idx - 1].id)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <DialogTitle className="flex-1 truncate text-center text-sm font-medium">
            {idx + 1}/{items.length} · {item?.name ?? ''}
          </DialogTitle>
          <Button
            variant="ghost"
            size="sm"
            disabled={idx < 0 || idx >= items.length - 1}
            onClick={() => onNavigate(items[idx + 1].id)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* 左:聚焦版本大图 + 分叉树 */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/40 p-6">
              {!focused ? (
                <span className="text-sm text-muted-foreground">尚无版本,先在批次页运行生成</span>
              ) : focused.state === 'pending' || focused.state === 'running' ? (
                <div className="flex flex-col items-center gap-2 text-purple-500">
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <span className="text-sm">{focused.state === 'pending' ? '排队中' : '生成中'}</span>
                </div>
              ) : focused.state === 'failed' ? (
                <div className="flex max-w-md flex-col items-center gap-2 text-center text-destructive">
                  <AlertCircle className="h-8 w-8" />
                  <span className="break-all text-sm">{focused.lastError ?? '生成失败'}</span>
                </div>
              ) : focused.label?.pngUrl ? (
                <img
                  src={focused.label.pngUrl}
                  alt={item?.name ?? ''}
                  onClick={() => setZoomUrl(focused.label!.pngUrl)}
                  className="max-h-full max-w-full cursor-zoom-in object-contain"
                  style={{ imageRendering: 'pixelated' }}
                />
              ) : (
                <span className="text-sm text-muted-foreground">无预览</span>
              )}
            </div>
            {focused?.effectivePrompt && (
              <details className="border-t px-4 py-2 text-xs text-muted-foreground">
                <summary className="cursor-pointer select-none">
                  本版本最终 prompt(v{versionNo(focused.id)} · {focused.genMode ?? focused.turnKind})
                </summary>
                <p className="mt-1 whitespace-pre-wrap break-all">{focused.effectivePrompt}</p>
              </details>
            )}
            {/* 分叉树:点节点 = 聚焦(预览 + fork 基准),不移动采用指针 */}
            <div className="shrink-0 border-t px-3 py-2">
              <div className="mb-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                <GitBranch className="h-3 w-3" />
                演进轨迹(点任意版本聚焦 → 从它继续改即 fork;
                <span className="text-blue-500">蓝框=聚焦</span>,
                <span className="text-primary">采用=打印版</span>)
              </div>
              <VersionTree
                turns={turns}
                adoptedId={adopted?.id ?? null}
                focusedId={focused?.id ?? null}
                versionNo={versionNo}
                onFocus={setFocusedTurnId}
              />
            </div>
          </div>

          {/* 右:对话流 + 输入区 */}
          <div className="flex w-[360px] shrink-0 flex-col border-l">
            <div className="flex-1 space-y-3 overflow-y-auto p-3">
              {turns.map((t, i) => (
                <div key={t.id} className="space-y-1">
                  {t.userFeedback ? (
                    <div className="ml-6 whitespace-pre-wrap rounded-lg bg-primary/10 px-3 py-2 text-xs">
                      {t.userFeedback}
                    </div>
                  ) : (
                    <div className="text-[10px] text-muted-foreground">
                      {t.turnKind === 'root' ? '初始生成(模板)' : '生成'}
                    </div>
                  )}
                  {/* agent 的确认回复 */}
                  {t.agentReply && (
                    <div className="mr-6 flex items-start gap-1.5 rounded-lg bg-purple-50 px-3 py-2 text-xs dark:bg-purple-950/30">
                      <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-purple-500" />
                      <span className="whitespace-pre-wrap">{t.agentReply}</span>
                    </div>
                  )}
                  {t.refImageUrls.length > 0 && (
                    <div className="ml-6 flex gap-1">
                      {t.refImageUrls.map((u) => (
                        <img
                          key={u}
                          src={u}
                          alt=""
                          onClick={() => setZoomUrl(u)}
                          className="h-8 w-8 cursor-zoom-in rounded border object-cover"
                        />
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => setFocusedTurnId(t.id)}
                    className={`mr-6 flex w-[calc(100%-1.5rem)] items-center gap-2 rounded-lg border px-2 py-1.5 text-left ${
                      t.id === focused?.id ? 'ring-2 ring-blue-500' : 'hover:border-primary/50'
                    } ${t.id === adopted?.id ? 'border-primary' : ''}`}
                  >
                    <div className="flex h-9 w-16 shrink-0 items-center justify-center rounded bg-muted">
                      <TurnThumb turn={t} />
                    </div>
                    <div className="min-w-0 flex-1 text-[10px] text-muted-foreground">
                      <div className="flex items-center gap-1">
                        v{i + 1} · {t.genMode ?? t.turnKind}
                        {t.id === adopted?.id && (
                          <span className="rounded bg-primary px-1 text-[8px] text-primary-foreground">
                            采用
                          </span>
                        )}
                      </div>
                      {t.state === 'failed' && (
                        <div className="truncate text-destructive">{t.lastError ?? '失败'}</div>
                      )}
                    </div>
                  </button>
                </div>
              ))}
              {turns.length === 0 && (
                <div className="pt-8 text-center text-xs text-muted-foreground">
                  {ensureQ.isLoading || treeQ.isLoading ? '加载中…' : '暂无生成历史'}
                </div>
              )}
            </div>

            {/* 输入区 / 路径选择器:补充上下文 → 规划(多路径)→ 选路径确认 → 生成 */}
            <div className="shrink-0 space-y-2 border-t p-3">
              {pendingPlan ? (
                pendingPlan.kind === 'clarify' ? (
                  <ClarifyChooser
                    plan={pendingPlan}
                    busy={busy}
                    onPick={onClarifyPick}
                    onCancel={cancelPlan}
                  />
                ) : (
                  <PathChooser
                    plan={pendingPlan}
                    versionNo={versionNo}
                    busy={busy}
                    onConfirm={(cp) => refineMut.mutate(cp)}
                    onCancel={cancelPlan}
                    onZoom={setZoomUrl}
                  />
                )
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <label
                      className="flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground"
                      title="开启后跳过路径选择,agent 规划完直接走推荐路径生成"
                    >
                      <input
                        type="checkbox"
                        className="h-3 w-3 accent-purple-500"
                        checked={trustMode}
                        onChange={(e) => setTrust(e.target.checked)}
                      />
                      <Zap className="h-3 w-3 text-purple-500" />
                      信任模式(走推荐路径直生)
                    </label>
                    {!focusedIsAdopted && focused && focused.state === 'succeeded' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-xs"
                        title="把聚焦的这一版设为当前采用版(batch 显示/打印用),不生成新版本"
                        disabled={adoptMut.isPending}
                        onClick={() => adoptMut.mutate(focused.id)}
                      >
                        <Check className="mr-1 h-3.5 w-3.5" />
                        采用此版本
                      </Button>
                    )}
                  </div>
                  <ReferencePool
                    turns={turns}
                    selected={poolSel}
                    onToggle={togglePool}
                    onZoom={setZoomUrl}
                  />
                  <RefImageUploader
                    urls={refUrls}
                    onChange={setRefUrls}
                    maxImages={3}
                    disabled={busy}
                  />
                  <Textarea
                    rows={3}
                    placeholder="补充上下文,例如:字再大一点、整体更可爱、去掉边框…(agent 会规划多条路径,含从干净版重开以避免越改越糊)"
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                  />
                  <Button
                    className="w-full"
                    size="sm"
                    disabled={!focused || !feedback.trim() || busy}
                    onClick={() => planMut.mutate({ fresh: false, clarifications: clarifyTrail })}
                  >
                    {busy ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : trustMode ? (
                      <Zap className="mr-1 h-4 w-4" />
                    ) : (
                      <Send className="mr-1 h-4 w-4" />
                    )}
                    {trustMode ? '生成' : '让 agent 规划路径'}
                    {focused ? `(聚焦 v${versionNo(focused.id)})` : ''}
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    size="sm"
                    disabled={!feedback.trim() || busy}
                    title="开一棵全新的树:只用你上传的图(图生图)或纯文字描述(文生图),不继承任何现有版本的像素/prompt"
                    onClick={() => planMut.mutate({ fresh: true, clarifications: clarifyTrail })}
                  >
                    <Sprout className="mr-1 h-4 w-4 text-green-600" />
                    全新起点(不继承现有版本)
                  </Button>
                  {focused && !focusedIsAdopted && (
                    <div className="text-center text-[10px] text-blue-500">
                      正在基于 v{versionNo(focused.id)} 修改(将从它 fork 出新分支)
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* 点击放大:深色遮罩 + 大图,点任意处关闭 */}
        {zoomUrl && (
          <div
            onClick={() => setZoomUrl(null)}
            className="fixed inset-0 z-[120] flex cursor-zoom-out items-center justify-center bg-black/80 p-6"
          >
            <img
              src={zoomUrl}
              alt=""
              className="max-h-full max-w-full object-contain"
              style={{ imageRendering: 'pixelated' }}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
