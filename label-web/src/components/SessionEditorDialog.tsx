import { Fragment, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  HelpCircle,
  Loader2,
  Plus,
  Printer,
  Send,
  Sparkles,
  Sprout,
  X,
  ZoomIn,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import PrintDeviceDialog from '@/components/PrintDeviceDialog';
import { useRefImageUpload } from '@/hooks/useRefImageUpload';
import { sessionsApi } from '@/api/sessions';
import { labelsApi } from '@/api/labels';
import { deviceKindsForTarget } from '@/types/device';
import type { PlanPath, PlanResponse, SessionTurn } from '@/types/session';
import type { BatchItem } from '@/types/batch';

interface Props {
  items: BatchItem[];
  itemId: string | null;
  targetId: string;
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
 * 演进轨迹(垂直时间线):y = 全局时间序(每版一行),lane = git 风格轨道
 * (长子继承父 lane,fork/次根开新 lane → 向右缩进)。SVG 折线连 parent→child。
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
  const ROW = 50;
  const ROOT_GAP = 18;
  const LANE = 16;
  const THUMB = 36;
  const PADX = 6;
  const PADY = 4;

  const byId = new Map(turns.map((t) => [t.id, t]));
  const childrenMap = new Map<string, SessionTurn[]>();
  turns.forEach((t) => {
    if (t.parentTurnId && byId.has(t.parentTurnId)) {
      const arr = childrenMap.get(t.parentTurnId) ?? [];
      arr.push(t);
      childrenMap.set(t.parentTurnId, arr);
    }
  });

  // lane:每棵 root 树【独立】从 0 算 —— 不同 root(全新起点)无血缘,都左对齐 lane0;只有树内分叉才缩进。
  // 不同树的时间段不重叠,所以 lane 数值复用不会水平相撞。长子继承父 lane,次子向右开新 lane。
  const laneOf = new Map<string, number>();
  let maxLane = 0;
  const assignLane = (t: SessionTurn, lane: number) => {
    laneOf.set(t.id, lane);
    (childrenMap.get(t.id) ?? []).forEach((c, i) => assignLane(c, i === 0 ? lane : ++maxLane));
  };
  turns.forEach((t) => {
    if (!t.parentTurnId || !byId.has(t.parentTurnId)) {
      maxLane = 0;
      assignLane(t, 0);
    }
  });

  // y 像素位置:时间序累积,每棵新树(全新起点 root)前留 ROOT_GAP 放分隔线
  const yPx = new Map<string, number>();
  let acc = PADY;
  turns.forEach((t, i) => {
    if ((!t.parentTurnId || !byId.has(t.parentTurnId)) && i > 0) acc += ROOT_GAP;
    yPx.set(t.id, acc);
    acc += ROW;
  });
  const H = acc + PADY;

  const dotX = (lane: number) => PADX + lane * LANE + THUMB / 2;
  const dotCY = (id: string) => yPx.get(id)! + THUMB / 2;

  if (turns.length === 0) return null;

  return (
    <div className="relative" style={{ height: H }}>
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
        {turns.map((t) => {
          if (!t.parentTurnId || !laneOf.has(t.parentTurnId) || !laneOf.has(t.id)) return null;
          const px = dotX(laneOf.get(t.parentTurnId)!);
          const py = dotCY(t.parentTurnId);
          const cx = dotX(laneOf.get(t.id)!);
          const cy = dotCY(t.id);
          // 同 lane → 直竖线;跨 lane(fork) → 先竖到子行再横折到子 lane
          const d = px === cx ? `M${px},${py} V${cy}` : `M${px},${py} V${cy} H${cx}`;
          return (
            <path
              key={t.id}
              d={d}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="text-muted-foreground/50"
            />
          );
        })}
      </svg>
      {turns.map((t, i) => {
        const lane = laneOf.get(t.id)!;
        const top = yPx.get(t.id)!;
        const isNewRoot = (!t.parentTurnId || !byId.has(t.parentTurnId)) && i > 0;
        const adopted = t.id === adoptedId;
        const focused = t.id === focusedId;
        return (
          <Fragment key={t.id}>
            {isNewRoot && (
              <div
                className="absolute flex items-center gap-1 text-[8px] text-muted-foreground/60"
                style={{ left: 2, right: 2, top: top - ROOT_GAP + 4 }}
              >
                <span className="h-px flex-1 bg-border" />
                全新起点
                <span className="h-px flex-1 bg-border" />
              </div>
            )}
            <button
              onClick={() => onFocus(t.id)}
              title={t.userFeedback ?? (t.turnKind === 'root' ? '初始版本' : '生成')}
              className={`absolute flex items-center gap-1.5 rounded-md border bg-background p-0.5 pr-1.5 text-left transition ${
                focused ? 'ring-2 ring-blue-500' : 'hover:border-primary/50'
              } ${
                t.state === 'failed'
                  ? 'border-destructive'
                  : adopted
                    ? 'border-primary'
                    : 'border-transparent'
              }`}
              style={{ left: PADX + lane * LANE, top, maxWidth: 168 }}
            >
              <div
                className="flex shrink-0 items-center justify-center overflow-hidden rounded bg-muted"
                style={{ width: THUMB, height: THUMB }}
              >
                <TurnThumb turn={t} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-medium text-foreground/70">v{versionNo(t.id)}</span>
                  {adopted && (
                    <span className="rounded bg-primary px-1 text-[8px] leading-tight text-primary-foreground">
                      采用
                    </span>
                  )}
                </div>
                {t.userFeedback && (
                  <div className="truncate text-[9px] leading-tight text-muted-foreground/70">
                    {t.userFeedback}
                  </div>
                )}
              </div>
            </button>
          </Fragment>
        );
      })}
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
  onSupplement,
}: {
  plan: PlanResponse;
  versionNo: (turnId: string) => number;
  busy: boolean;
  onConfirm: (c: ConfirmedPlan) => void;
  onCancel: () => void;
  onZoom: (url: string) => void;
  onSupplement: (text: string) => void;
}) {
  const paths = plan.paths ?? [];
  const [pathId, setPathId] = useState<string>(() => pickRecommended(paths).id);
  const [suppOpen, setSuppOpen] = useState(false);
  const [supp, setSupp] = useState('');
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

      {/* 补充说明:以上方案都不满意 → 补充更多想法,让 agent 接收后重新出方案(必有的常驻入口) */}
      <div className="rounded-md border border-dashed">
        {!suppOpen ? (
          <button
            onClick={() => setSuppOpen(true)}
            className="flex w-full items-center gap-1.5 px-2 py-1.5 text-[11px] text-muted-foreground transition hover:text-foreground"
          >
            <Sparkles className="h-3.5 w-3.5 text-purple-500" />
            以上方案都不满意?补充更多想法,让 agent 重新规划
          </button>
        ) : (
          <div className="space-y-1.5 p-2">
            <Textarea
              rows={2}
              autoFocus
              placeholder="补充你的想法,例如:都太复杂了要更简洁;或保留 v3 构图但换配色…(agent 会结合它重新出方案)"
              value={supp}
              onChange={(e) => setSupp(e.target.value)}
              className="text-xs"
            />
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => {
                  setSuppOpen(false);
                  setSupp('');
                }}
              >
                收起
              </Button>
              <Button
                size="sm"
                className="h-7 flex-1 text-xs"
                disabled={busy || !supp.trim()}
                onClick={() => onSupplement(supp.trim())}
              >
                <Send className="mr-1 h-3.5 w-3.5" />
                提交补充,重新规划
              </Button>
            </div>
          </div>
        )}
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

export default function SessionEditorDialog({ items, itemId, targetId, onClose, onNavigate }: Props) {
  const qc = useQueryClient();
  const item = items.find((i) => i.id === itemId) ?? null;
  const idx = item ? items.findIndex((i) => i.id === item.id) : -1;

  // 设备化:在编辑器内直接打印/推送「当前采用版」到设备(走单标签 labelsApi.print)
  const [printOpen, setPrintOpen] = useState(false);
  const printAction = deviceKindsForTarget(targetId).includes('thermal-printer') ? '打印' : '推送';
  const printMut = useMutation({
    mutationFn: (deviceId: string) => labelsApi.print(item!.label!.id, { deviceId }),
    onSuccess: () => {
      toast.success(`${printAction}任务已发送`);
      setPrintOpen(false);
      qc.invalidateQueries({ queryKey: ['batch'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? `${printAction}失败`),
  });

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
  const [focusedTurnId, setFocusedTurnId] = useState<string | null>(null);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  // 已解决的澄清问答 + 用户主动补充想法的累积链,作为后续 /plan 的上下文
  const [clarifyTrail, setClarifyTrail] = useState<string[]>([]);

  const focused = turns.find((t) => t.id === focusedTurnId) ?? adopted;

  // 切换聚焦 item 时清空输入与待确认提案,聚焦交还给采用指针
  useEffect(() => {
    setFeedback('');
    setRefUrls([]);
    setPendingPlan(null);
    setFocusedTurnId(null);
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
      setPendingPlan(null);
      setClarifyTrail([]);
      toast.success('已开始生成新版本');
      invalidate();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? '生成失败'),
  });

  // 规划:调 /plan 拿多条路径,弹面板让用户选(总是经过规划这步 —— 多方案天然含选择性,
  // 且后端保证必有「全新起点」兜底路径)。staged 上下文 = 用户本轮上传的新图。
  const planMut = useMutation({
    mutationFn: (vars: { clarifications: string[] }) => {
      const staged = [...new Set(refUrls)];
      return sessionsApi.plan(sessionId!, {
        parentTurnId: focused?.id ?? null,
        feedback: feedback.trim(),
        refImageUrls: staged.length ? staged : undefined,
        fresh: false,
        clarifications: vars.clarifications.length ? vars.clarifications : undefined,
      });
    },
    onSuccess: (plan) => {
      if (plan.kind === 'paths' && !plan.paths?.length) {
        toast.error('未能生成规划路径');
        return;
      }
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
    planMut.mutate({ clarifications: newTrail });
  };
  // 用户主动「补充说明」→ 追加到 trail,带着它重新规划(以上方案都不满意时的再规划入口)
  const onSupplement = (text: string) => {
    const newTrail = [...clarifyTrail, `补充想法:${text}`];
    setClarifyTrail(newTrail);
    setPendingPlan(null);
    planMut.mutate({ clarifications: newTrail });
  };

  // 采用某版本作为当前(打印/显示用),移动指针但不生成
  const adoptMut = useMutation({
    mutationFn: (turnId: string) => sessionsApi.select(sessionId!, turnId),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e?.response?.data?.error ?? '采用失败'),
  });

  const busy = planMut.isPending || refineMut.isPending;
  const focusedIsAdopted = focused?.id === adopted?.id;
  const up = useRefImageUpload({
    urls: refUrls,
    onChange: setRefUrls,
    maxImages: 10,
    disabled: busy,
  });

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
    <>
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
          {item?.label?.id && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPrintOpen(true)}
              title={`${printAction}当前采用版本到设备`}
            >
              <Printer className="mr-1 h-4 w-4" />
              {printAction}
            </Button>
          )}
        </div>

        <div className="flex flex-1 min-h-0">
          {/* 最左:演进轨迹竖列(独占整列高度,垂直时间线 + fork 缩进,垂直滚动) */}
          <div className="flex w-[196px] shrink-0 flex-col border-r">
            <div
              className="flex items-center gap-1 border-b px-2 py-2 text-[10px] text-muted-foreground"
              title="点任意版本聚焦(蓝框=聚焦);从聚焦版继续改即 fork;采用=打印版"
            >
              <GitBranch className="h-3 w-3 shrink-0" />
              演进轨迹
            </div>
            <div className="flex-1 overflow-y-auto px-1 py-1">
              {turns.length ? (
                <VersionTree
                  turns={turns}
                  adoptedId={adopted?.id ?? null}
                  focusedId={focused?.id ?? null}
                  versionNo={versionNo}
                  onFocus={setFocusedTurnId}
                />
              ) : (
                <div className="px-2 py-4 text-center text-[10px] text-muted-foreground">
                  {ensureQ.isLoading || treeQ.isLoading ? '加载中…' : '暂无生成历史'}
                </div>
              )}
            </div>
            <div className="border-t px-2 py-1 text-[8px] leading-tight text-muted-foreground">
              <span className="text-blue-500">蓝框</span>=聚焦 ·{' '}
              <span className="text-primary">采用</span>=打印版
            </div>
          </div>
          {/* 中:聚焦版本大图 + 本版 prompt */}
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
                    onSupplement={onSupplement}
                  />
                )
              ) : (
                <>
                  {!focusedIsAdopted && focused && focused.state === 'succeeded' && (
                    <div className="flex justify-end">
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
                    </div>
                  )}
                  <div className="rounded-lg border bg-background focus-within:ring-1 focus-within:ring-ring">
                    {refUrls.length > 0 && (
                      <div className="flex flex-wrap gap-2 p-2 pb-0">
                        {refUrls.map((url, idx) => (
                          <div
                            key={idx}
                            className="relative h-14 w-14 overflow-hidden rounded-md border bg-muted group"
                          >
                            <img
                              src={url}
                              alt={`ref-${idx + 1}`}
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                            <button
                              type="button"
                              onClick={() => up.remove(idx)}
                              disabled={busy}
                              className="absolute top-0.5 right-0.5 rounded bg-background/80 p-0.5 opacity-0 group-hover:opacity-100 hover:bg-destructive hover:text-destructive-foreground transition"
                              title="移除"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <Textarea
                      rows={3}
                      placeholder="说说要怎么改,例如:字再大一点、整体更可爱、去掉边框…(支持 Ctrl+V 粘贴参考图)"
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      onPaste={up.handlePaste}
                      className="border-0 focus-visible:ring-0 resize-none shadow-none"
                    />
                    <div className="flex items-center justify-between gap-2 p-2 pt-0">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={up.openPicker}
                          disabled={!up.canAddMore || up.isUploading}
                          title="添加参考图（或 Ctrl+V 粘贴）"
                          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 transition"
                        >
                          {up.isUploading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Plus className="h-4 w-4" />
                          )}
                        </button>
                        <span className="text-[10px] text-muted-foreground">
                          {refUrls.length}/10 · AI 视觉输入
                        </span>
                      </div>
                      <Button
                        size="sm"
                        className="h-7"
                        disabled={!focused || !feedback.trim() || busy}
                        onClick={() => planMut.mutate({ clarifications: clarifyTrail })}
                      >
                        {busy ? (
                          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="mr-1 h-4 w-4" />
                        )}
                        让 agent 规划方案
                        {focused ? `(聚焦 v${versionNo(focused.id)})` : ''}
                      </Button>
                    </div>
                    <input
                      type="file"
                      ref={up.inputRef}
                      onChange={up.handleInputChange}
                      accept={up.accept}
                      multiple
                      className="hidden"
                    />
                  </div>
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
    {item?.label?.id && (
      <PrintDeviceDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        targetId={targetId}
        pending={printMut.isPending}
        onConfirm={(deviceId) => printMut.mutate(deviceId)}
        title={`${printAction}标签`}
        description={`选择一台设备${printAction}当前采用版本。`}
      />
    )}
    </>
  );
}
