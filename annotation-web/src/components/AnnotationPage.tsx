import { useState, useEffect, useMemo, useRef, useDeferredValue, type CSSProperties } from 'react';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient } from '../api/client';
import NeuromancerReviewPage from './NeuromancerReviewPage';
import { devicesApi, type Device } from '../api/devices';
import { useSearchParams, Link } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FlaskConical,
  Image as ImageIcon,
  Send,
  Search,
  GripVertical,
  List,
  Newspaper,
  SlidersHorizontal,
  ThumbsDown,
  ThumbsUp,
  Sparkles,
  GitCompareArrows,
} from 'lucide-react';
import {
  RendererComparisonView,
  RendererReviewActions,
  type RendererReviewDraft,
} from './RendererReviewPanel';

const DEFAULT_RENDERER_DRAFT: RendererReviewDraft = {
  choice: null,
  informationRetention: 4,
  readability: 4,
  spaceUsage: 4,
  physicalConfidence: 3,
  note: '',
};

interface NewsRecord {
  id: number;
  title: string;
  category: string;
  dataSource: string;
  imagePath: string | null;
  pushedAt: Date;
  pushedAtUtc?: string | null;
  annotationStatus: 'pending' | 'annotating' | 'completed' | 'skipped';
  isRecent?: boolean;
  rawContent?: any;
  processedContent?: any;
  contentOrigin?: {
    kind?: 'neuromancer' | 'processed' | 'delivery' | string;
    signature?: string | null;
    producer?: string | null;
    jobId?: string | null;
    layer?: string | null;
    contractVersion?: string | null;
  };
}

function AnnotationPage() {
  const [searchParams] = useSearchParams();
  if (searchParams.get('view') === 'neuromancer') {
    return <NeuromancerReviewPage />;
  }
  return <ContentAnnotationPage />;
}

function ContentAnnotationPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [reviewMode, setReviewMode] = useState<'content' | 'renderers'>('content');
  const [rendererTargetId, setRendererTargetId] = useState('eink-296x152');
  const [rendererDraft, setRendererDraft] = useState<RendererReviewDraft>(DEFAULT_RENDERER_DRAFT);
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery.trim());
  const [mobilePane, setMobilePane] = useState<'list' | 'preview' | 'actions'>('list');
  const [pushTarget, setPushTarget] = useState<{cloud: boolean, esp32: boolean}>({cloud: false, esp32: true});
  // null 表示全部启用的本地墨水屏；从设备管理页跳转时会自动锁定到指定设备。
  const [selectedEinkDeviceIds, setSelectedEinkDeviceIds] = useState<string[] | null>(null);
  const [searchParams] = useSearchParams();
  const requestedDeviceId = searchParams.get('device');

  // 从localStorage读取列宽配置，默认值：25%, 50%, 25%
  const [leftWidth, setLeftWidth] = useState(() => {
    const saved = localStorage.getItem('annotation-left-width');
    return saved ? parseFloat(saved) : 25;
  });
  const [middleWidth, setMiddleWidth] = useState(() => {
    const saved = localStorage.getItem('annotation-middle-width');
    return saved ? parseFloat(saved) : 50;
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef<'left' | 'right' | null>(null);
  const queryClient = useQueryClient();

  // 拖动事件处理
  const handleMouseDown = (divider: 'left' | 'right') => (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = divider;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDraggingRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const containerRect = container.getBoundingClientRect();
    const mouseX = e.clientX - containerRect.left;
    const percentage = (mouseX / containerRect.width) * 100;

    if (isDraggingRef.current === 'left') {
      // 左侧分隔条：调整左列宽度（限制在15%-40%）
      const newLeftWidth = Math.max(15, Math.min(40, percentage));
      setLeftWidth(newLeftWidth);
      localStorage.setItem('annotation-left-width', String(newLeftWidth));
    } else {
      // 右侧分隔条：调整中间列宽度（限制在30%-70%）
      const newMiddleWidth = Math.max(30, Math.min(70, percentage - leftWidth));
      setMiddleWidth(newMiddleWidth);
      localStorage.setItem('annotation-middle-width', String(newMiddleWidth));
    }
  };

  const handleMouseUp = () => {
    isDraggingRef.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [leftWidth]);

  // 稳定内容主体统计：不再扫描几十万条 delivery JSONB。
  const { data: statisticsData } = useQuery({
    queryKey: ['review-statistics'],
    queryFn: () => apiClient.getReviewStatistics(),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const {
    data: devicesData,
    isLoading: devicesLoading,
    error: devicesError,
  } = useQuery({
    queryKey: ['devices'],
    queryFn: () => devicesApi.getDevices(),
    refetchInterval: 30000,
  });

  const einkDevices = useMemo(
    () => ((devicesData?.data || []) as Device[]).filter(
      (device) => device.enabled && device.kind === 'eink-local'
    ),
    [devicesData?.data]
  );

  // 设备管理页的“去推送”按钮通过 ?device=eink-2 直接带入目标设备。
  useEffect(() => {
    if (!requestedDeviceId || !einkDevices.some((device) => device.id === requestedDeviceId)) {
      return;
    }
    setPushTarget((target) => ({ ...target, esp32: true }));
    setSelectedEinkDeviceIds((current) =>
      current?.length === 1 && current[0] === requestedDeviceId ? current : [requestedDeviceId]
    );
  }, [einkDevices, requestedDeviceId]);

  // 首屏只读轻量 review subject；raw/processed JSON 在选中后才按 id 懒加载。
  const PAGE_SIZE = 50;

  const {
    data: newsData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['review-subjects', deferredSearchQuery],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => apiClient.getReviewSubjects({
      limit: PAGE_SIZE,
      ...(deferredSearchQuery ? { search: deferredSearchQuery } : {}),
      ...(pageParam ? { cursor: pageParam } : {}),
    }),
    getNextPageParam: (lastPage) =>
      lastPage.pagination?.hasMore ? lastPage.pagination.nextCursor || undefined : undefined,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  // 处理数据并排序
  const parsePushedAt = (item: any): { date: Date; utc?: string | null } => {
    if (typeof item.pushedAtEpoch === 'number') {
      return { date: new Date(item.pushedAtEpoch), utc: item.pushedAtUtc };
    }
    if (item.pushedAtUtc) {
      return { date: new Date(item.pushedAtUtc), utc: item.pushedAtUtc };
    }
    if (item.pushedAt) {
      const normalized = item.pushedAt
        .replace(/\//g, '-')
        .replace(' ', 'T');
      return { date: new Date(`${normalized}+08:00`) };
    }
    return { date: new Date() };
  };

  const allPages = newsData?.pages ?? [];

  const newsList = useMemo(() => {
    const combined = allPages.flatMap((page: any) => page?.data || []);
    return combined.map((item: any): NewsRecord => {
      const { date: pushedAtDate, utc: pushedAtUtc } = parsePushedAt(item);
      return {
        id: item.id,
        title: item.title || '未知标题',
        category: item.category || 'unknown',
        dataSource: item.dataSource || '未知',
        imagePath: item.imagePath,
        pushedAt: pushedAtDate,
        pushedAtUtc,
        annotationStatus: item.annotationStatus || 'pending',
        isRecent: Date.now() - pushedAtDate.getTime() < 3600000,
        contentOrigin: item.contentOrigin,
      };
    }).sort((a, b) => b.pushedAt.getTime() - a.pushedAt.getTime());
  }, [allPages]);

  const progress = statisticsData?.data?.progress;
  const firstPageTotal = allPages[0]?.pagination?.total;
  const overallTotal = deferredSearchQuery
    ? (firstPageTotal ?? newsList.length)
    : (progress?.total_count ?? firstPageTotal ?? newsList.length);
  const statusCounts = useMemo(() => {
    return newsList.reduce(
      (acc, record) => {
        if (record.annotationStatus === 'completed') {
          acc.completed += 1;
        } else if (record.annotationStatus === 'skipped') {
          acc.skipped += 1;
        } else {
          acc.pending += 1;
        }
        return acc;
      },
      { pending: 0, completed: 0, skipped: 0 }
    );
  }, [newsList]);
  const pendingTotal = progress?.pending_count ?? statusCounts.pending;
  const completedTotal = progress?.completed_count ?? statusCounts.completed;
  const skippedTotal = progress?.skipped_count ?? statusCounts.skipped;

  // 搜索已移到服务端的稳定主体索引；deferred value 保证输入过程不阻塞交互。
  const filteredList = newsList;
  const isSearchPending = searchQuery.trim() !== deferredSearchQuery;

  // 列表只保留轻量摘要；当前条目的大 JSON 按 id 懒加载。
  const selectedRecord = selectedId
    ? filteredList.find(r => r.id === selectedId)
    : filteredList[0];
  const currentRecordSummary = selectedRecord || filteredList[0];
  const {
    data: currentDetailData,
    isFetching: isDetailLoading,
  } = useQuery({
    queryKey: ['push-detail', currentRecordSummary?.id],
    queryFn: () => apiClient.getPushDetail(currentRecordSummary!.id),
    enabled: Boolean(currentRecordSummary?.id),
    staleTime: 60_000,
  });
  const currentRecord = useMemo(() => {
    if (!currentRecordSummary) return undefined;
    const detail = currentDetailData?.data;
    return {
      ...currentRecordSummary,
      imagePath: detail?.image_path || currentRecordSummary.imagePath,
      rawContent: detail?.raw_content,
      processedContent: detail?.processed_content,
      contentOrigin: currentRecordSummary.contentOrigin || {
        kind: detail?.layer === 'external-renderable' || detail?.job_id === 'renderable-intake'
          ? 'neuromancer'
          : 'delivery',
        signature: detail?.processed_content?.signature,
        producer: detail?.processed_content?.metadata?.producer,
        jobId: detail?.job_id,
        layer: detail?.layer,
        contractVersion: detail?.processed_content?.metadata?.contractVersion,
      },
    };
  }, [currentRecordSummary, currentDetailData?.data]);

  const { data: rendererTargetsData } = useQuery({
    queryKey: ['renderer-review-targets'],
    queryFn: () => apiClient.getRendererReviewTargets(),
    staleTime: 5 * 60_000,
    enabled: reviewMode === 'renderers',
  });
  const rendererTargets = rendererTargetsData?.data || [];
  const {
    data: rendererComparisonData,
    isFetching: rendererComparisonLoading,
    error: rendererComparisonError,
  } = useQuery({
    queryKey: ['renderer-comparison', currentRecordSummary?.id, rendererTargetId],
    queryFn: () => apiClient.getRendererComparison(currentRecordSummary!.id, rendererTargetId),
    enabled: reviewMode === 'renderers' && Boolean(currentRecordSummary?.id),
    staleTime: 30_000,
  });
  const rendererComparison = rendererComparisonData?.data;

  useEffect(() => {
    if (reviewMode !== 'renderers') return;
    const review = rendererComparison?.review;
    if (!review) {
      setRendererDraft(DEFAULT_RENDERER_DRAFT);
      return;
    }
    setRendererDraft({
      choice: review.choice === 'primary' || review.choice === 'candidate' || review.choice === 'tie' ? review.choice : null,
      informationRetention: review.information_retention ?? 4,
      readability: review.readability ?? 4,
      spaceUsage: review.space_usage ?? 4,
      physicalConfidence: review.physical_confidence ?? 3,
      note: review.note ?? '',
    });
  }, [reviewMode, currentRecordSummary?.id, rendererTargetId, rendererComparison?.review?.updated_at]);

  const rendererReviewMutation = useMutation({
    mutationFn: async () => {
      if (!currentRecordSummary?.id || !rendererDraft.choice) throw new Error('请先选择 A / B / 差不多');
      return apiClient.saveRendererReview(currentRecordSummary.id, {
        targetId: rendererTargetId,
        choice: rendererDraft.choice,
        informationRetention: rendererDraft.informationRetention,
        readability: rendererDraft.readability,
        spaceUsage: rendererDraft.spaceUsage,
        physicalConfidence: rendererDraft.physicalConfidence,
        note: rendererDraft.note,
        metricsSnapshot: rendererComparison ? {
          version: rendererComparison.version,
          governanceVersion: rendererComparison.governanceVersion,
          target: rendererComparison.target,
          governance: rendererComparison.governance,
          comparison: rendererComparison.comparison,
          selfCheck: rendererComparison.selfCheck,
          diffSummary: {
            candidateVsPrimary: rendererComparison.diffs?.candidateVsPrimary ? {
              exact: rendererComparison.diffs.candidateVsPrimary.exact,
              changedPixels: rendererComparison.diffs.candidateVsPrimary.changedPixels,
              changedRatio: rendererComparison.diffs.candidateVsPrimary.changedRatio,
              bounds: rendererComparison.diffs.candidateVsPrimary.bounds,
              regions: rendererComparison.diffs.candidateVsPrimary.regions,
            } : undefined,
            browserVsCandidate: rendererComparison.diffs?.browserVsCandidate ? {
              exact: rendererComparison.diffs.browserVsCandidate.exact,
              changedPixels: rendererComparison.diffs.browserVsCandidate.changedPixels,
              changedRatio: rendererComparison.diffs.browserVsCandidate.changedRatio,
              bounds: rendererComparison.diffs.browserVsCandidate.bounds,
              regions: rendererComparison.diffs.browserVsCandidate.regions,
            } : undefined,
          },
          primary: {
            renderer: rendererComparison.primary?.renderer,
            renderMetrics: rendererComparison.primary?.renderMetrics,
            bitmapMetrics: rendererComparison.primary?.bitmapMetrics,
          },
          candidate: {
            renderer: rendererComparison.candidate?.renderer,
            layoutEngine: rendererComparison.candidate?.layoutEngine,
            renderMetrics: rendererComparison.candidate?.renderMetrics,
            bitmapMetrics: rendererComparison.candidate?.bitmapMetrics,
            physicalPreview: rendererComparison.candidate?.physicalPreview ? {
              pointToPoint: rendererComparison.candidate.physicalPreview.pointToPoint,
              resizeApplied: rendererComparison.candidate.physicalPreview.resizeApplied,
              planeSha256: rendererComparison.candidate.physicalPreview.planeSha256,
            } : undefined,
          },
          browserProbe: {
            renderer: rendererComparison.browserProbe?.renderer,
            renderMetrics: rendererComparison.browserProbe?.renderMetrics,
            bitmapMetrics: rendererComparison.browserProbe?.bitmapMetrics,
            diagnosticOnly: rendererComparison.browserProbe?.diagnosticOnly,
          },
          reference: {
            renderer: rendererComparison.reference?.renderer,
            renderMetrics: rendererComparison.reference?.renderMetrics,
            bitmapMetrics: rendererComparison.reference?.bitmapMetrics,
          },
        } : undefined,
      });
    },
    onSuccess: () => {
      toast.success('Renderer A/B 评审已保存');
      queryClient.invalidateQueries({ queryKey: ['renderer-comparison', currentRecordSummary?.id, rendererTargetId] });
    },
    onError: (error: Error) => toast.error(`Renderer A/B 评审保存失败: ${error.message}`),
  });

  // 格式化时间显示
  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;

    // 超过7天显示具体日期
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = date.getHours();
    const minute = date.getMinutes();
    return `${month}/${day} ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  };

  // 手动渲染的 mutation（仅在没有历史图片时使用）
  const renderMutation = useMutation({
    mutationFn: async (newsId: number) => {
      const response = await apiClient.client.post(
        `/api/annotation/news/${newsId}/render-preview`
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review-subjects'] });
      queryClient.invalidateQueries({ queryKey: ['push-detail', currentRecord?.id] });
    },
  });

  // 获取预览图路径
  const previewImagePath = currentRecord?.imagePath
    ? `/api/minio-proxy${currentRecord.imagePath}`
    : (renderMutation.isSuccess && renderMutation.data?.success
      ? `/api/minio-proxy${renderMutation.data.data.imagePath}`
      : null);

  // 快速标注mutation（点赞/点踩）
  const quickAnnotateMutation = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'like' | 'dislike' }) =>
      apiClient.quickAnnotate(id, action),
    onSuccess: (_, { id, action }) => {
      toast.success(action === 'like' ? '👍 已标记为高质量' : '👎 已标记为低质量');
      queryClient.invalidateQueries({ queryKey: ['review-subjects'] });
      queryClient.invalidateQueries({ queryKey: ['review-statistics'] });
      queryClient.invalidateQueries({ queryKey: ['push-detail', id] });

      // 自动跳转到下一条
      handleNext();
    },
    onError: () => {
      toast.error('标注失败，请重试');
    },
  });

  // 推送mutation
  const pushMutation = useMutation({
    mutationFn: ({id, renderer, deviceIds}: {
      id: number;
      renderer: 'device' | 'local-eink' | 'both';
      deviceIds?: string[];
    }) => apiClient.resendPush(id, renderer, deviceIds),
    onSuccess: (response) => {
      const results = response.data?.results || [];
      const failures = results.filter((result: any) => !result.success);
      if (failures.length > 0) {
        toast.error(`推送未完全成功：${failures.map((result: any) => result.error || result.renderer).join('；')}`);
      } else {
        toast.success('📤 已推送到选中设备');
      }
      queryClient.invalidateQueries({ queryKey: ['push-history-all'] });
    },
    onError: (error: Error) => {
      toast.error(`推送失败: ${error.message}`);
    },
  });

  const handleSelectRecord = (record: NewsRecord) => {
    setSelectedId(record.id);
    setMobilePane('preview');
  };

  const handlePrevious = () => {
    const currentIdx = filteredList.findIndex(r => r.id === selectedId);
    if (currentIdx > 0) {
      setSelectedId(filteredList[currentIdx - 1].id);
    }
  };

  const handleNext = () => {
    const currentIdx = filteredList.findIndex(r => r.id === selectedId);
    if (currentIdx >= 0 && currentIdx < filteredList.length - 1) {
      setSelectedId(filteredList[currentIdx + 1].id);
    }
  };

  const handleSkip = () => {
    handleNext();
  };

  const handleQuickAnnotate = (action: 'like' | 'dislike') => {
    if (currentRecord && !quickAnnotateMutation.isPending) {
      quickAnnotateMutation.mutate({ id: currentRecord.id, action });
    }
  };

  const handleRenderPreview = () => {
    if (currentRecord) {
      renderMutation.mutate(currentRecord.id);
    }
  };

  const handlePush = () => {
    if (!currentRecord) return;
    let renderer: 'device' | 'local-eink' | 'both';
    if (pushTarget.cloud && pushTarget.esp32) renderer = 'both';
    else if (pushTarget.cloud) renderer = 'device';
    else if (pushTarget.esp32) renderer = 'local-eink';
    else return;

    if (pushTarget.esp32 && selectedEinkDeviceIds && selectedEinkDeviceIds.length === 0) {
      toast.error('请至少选择一台本地墨水屏');
      return;
    }

    pushMutation.mutate({
      id: currentRecord.id,
      renderer,
      deviceIds: pushTarget.esp32 && selectedEinkDeviceIds ? selectedEinkDeviceIds : undefined,
    });
  };

  // 搜索时重置选中
  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    setSelectedId(null);
  };

  // 键盘快捷键（WASD布局）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 检查是否在输入框中，避免干扰正常输入
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      // W键：点赞（高质量/好）
      if (e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        handleQuickAnnotate('like');
      }
      // S键：点踩（低质量/差）
      else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        handleQuickAnnotate('dislike');
      }
      // A键：上一条
      else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        handlePrevious();
      }
      // D键：下一条
      else if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        handleNext();
      }
      // Space：跳过
      else if (e.key === ' ') {
        e.preventDefault();
        handleSkip();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, filteredList, currentRecord]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!currentRecord) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <Search className="w-16 h-16 mx-auto mb-4 text-gray-300" />
        <p className="text-lg text-gray-600">
          {searchQuery ? '未找到匹配的记录' : '暂无数据'}
        </p>
        <p className="text-sm text-gray-500 mt-2">
          {searchQuery ? `没有包含 "${searchQuery}" 的记录` : '暂无任何新闻或推送记录'}
        </p>
        {searchQuery && (
          <button
            onClick={() => handleSearchChange('')}
            className="mt-4 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            清除搜索
          </button>
        )}
      </div>
    );
  }

  const currentIdx = filteredList.findIndex(r => r.id === selectedId);
  const isNeuromancerEnhanced = currentRecord.contentOrigin?.kind === 'neuromancer'
    || currentRecord.processedContent?.signature === '神经漫游者'
    || currentRecord.processedContent?.metadata?.producer === 'external-renderable-agent';
  const researchReceipt = currentRecord.processedContent?.metadata?.researchReceipt ?? currentRecord.rawContent?.researchReceipt;
  const researchSources = Array.isArray(researchReceipt?.sources) ? researchReceipt.sources : [];
  const researchClaims = Array.isArray(researchReceipt?.claims) ? researchReceipt.claims : [];
  const researchUsage = researchReceipt?.usage;
  const researchRetrieval = researchReceipt?.retrieval;
  const provenance = currentRecord.processedContent?.metadata?.provenance ?? currentRecord.rawContent?.provenance;
  const legacyProvenanceCount = Array.isArray(provenance)
    ? provenance.length
    : provenance && typeof provenance === 'object'
      ? Object.keys(provenance).length
      : 0;
  const provenanceCount = researchSources.length || legacyProvenanceCount;
  const researchRoleLabel: Record<string, string> = {
    seed: 'Seed',
    primary: '原始',
    official: '官方',
    secondary: '二级来源',
    syndicated: '转载',
    community: '社区',
  };
  const mobileTabs = [
    { id: 'list', label: '列表', icon: List },
    { id: 'preview', label: '预览', icon: Newspaper },
    { id: 'actions', label: '操作', icon: SlidersHorizontal },
  ] as const;

  return (
    <div ref={containerRef} className="flex min-h-0 flex-col gap-3 lg:h-[calc(100dvh-8rem)] lg:flex-row lg:gap-0">
      <div className="sticky top-0 z-20 grid grid-cols-3 gap-1 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-1.5 shadow-[var(--shadow-soft)] backdrop-blur-xl lg:hidden">
        {mobileTabs.map((tab) => {
          const Icon = tab.icon;
          const active = mobilePane === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setMobilePane(tab.id)}
              aria-pressed={active}
              className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-2 text-sm font-semibold transition-[background-color,color,transform,box-shadow] duration-200 ease-[var(--ease-snappy)] active:scale-[0.98] motion-reduce:transform-none ${
                active
                  ? 'bg-primary-600 text-white shadow-md shadow-primary-600/20'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--surface-2)]'
              }`}
            >
              <Icon className="size-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 第一列：新闻列表 */}
      <div
        style={{ '--panel-width': `${leftWidth}%` } as CSSProperties}
        className={`${mobilePane === 'list' ? 'flex' : 'hidden'} h-[calc(100dvh-10.5rem)] w-full flex-col overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-1)] shadow-[var(--shadow-soft)] lg:flex lg:h-full lg:w-[var(--panel-width)] lg:rounded-r-none`}
      >
        {/* 搜索框 */}
        <div className="p-4 border-b border-gray-200 flex-shrink-0">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">内容标注</p>
            <Link
              to="/annotate?view=neuromancer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[color-mix(in_oklab,var(--agent)_25%,var(--border-subtle))] bg-[var(--agent-soft)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--agent)]"
            >
              <FlaskConical className="size-3.5" /> 神经漫游者 A/B
            </Link>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索标题、分类或数据源..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => handleSearchChange('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* 统计信息 */}
          <div className="mt-2 text-xs text-gray-600">
            {searchQuery ? (
              <>
                {isSearchPending ? (
                  <span className="text-[var(--text-muted)]">正在检索稳定内容主体…</span>
                ) : (
                  <>
                    找到 <span className="font-semibold text-[var(--brand-strong)]">{overallTotal}</span> 条结果
                    <span className="ml-1 text-[var(--text-muted)]">（当前加载 {newsList.length}）</span>
                  </>
                )}
              </>
            ) : (
              <>
                共 {overallTotal} 条 ·
                <span className="text-green-600 ml-1">{pendingTotal} 待标注</span> ·
                <span className="text-blue-600 ml-1">{completedTotal} 已标注</span> ·
                <span className="text-gray-600 ml-1">{skippedTotal} 已跳过</span>
                {overallTotal > newsList.length && (
                  <span className="ml-1 text-orange-600">
                    （当前已加载 {newsList.length} 条最新记录）
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        {/* 新闻列表 */}
        <div className="flex-1 overflow-y-auto">
          {filteredList.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <Search className="w-12 h-12 mb-2 opacity-50" />
              <p>{searchQuery ? '未找到匹配的记录' : '暂无记录'}</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {filteredList.map((record) => {
                const isSelected = record.id === selectedId;
                return (
                  <div
                    key={record.id}
                    onClick={() => handleSelectRecord(record)}
                    aria-current={isSelected ? 'true' : undefined}
                    className={`review-list-item p-4 cursor-pointer ${
                      isSelected ? 'review-list-item-selected' : ''
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* 缩略图 */}
                      <div className="flex-shrink-0 w-16 h-16 bg-gray-100 rounded overflow-hidden">
                        {record.imagePath ? (
                          <img
                            src={`/api/minio-proxy${record.imagePath}`}
                            alt=""
                            className="w-full h-full object-cover"
                            loading="lazy"
                            decoding="async"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <ImageIcon className="w-6 h-6 text-gray-400" />
                          </div>
                        )}
                      </div>

                      {/* 内容 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <h3 className="review-list-item-title text-sm font-medium line-clamp-2">
                            {record.title}
                          </h3>
                        </div>

                        {/* 状态标签 */}
                        <div className="flex items-center gap-1.5 text-xs mt-2 flex-wrap">
                          {record.annotationStatus === 'pending' && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-2)] px-1.5 py-0.5 font-medium text-[var(--text-secondary)]">
                              <span className="size-1.5 rounded-full bg-[var(--success)]" /> 待标注
                            </span>
                          )}
                          {record.annotationStatus === 'completed' && (
                            <span className="rounded-full border border-primary-500/20 bg-[var(--brand-soft)] px-1.5 py-0.5 font-medium text-[var(--brand-strong)]">
                              已标注
                            </span>
                          )}
                          {record.annotationStatus === 'skipped' && (
                            <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface-3)] px-1.5 py-0.5 font-medium text-[var(--text-muted)]">
                              已跳过
                            </span>
                          )}
                          {record.contentOrigin?.kind === 'neuromancer' && (
                            <span className="review-origin-badge">
                              <Sparkles className="size-3" /> Neuromancer 增强
                            </span>
                          )}
                          {record.isRecent && (
                            <span className="rounded-full border border-[color-mix(in_oklab,var(--warning)_28%,transparent)] bg-[var(--warning-soft)] px-1.5 py-0.5 font-medium text-[var(--warning)]">
                              最新
                            </span>
                          )}
                          <span className="text-gray-500">{record.category}</span>
                          <span className="text-gray-400">·</span>
                          <span className="text-gray-500">{formatTime(record.pushedAt)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {hasNextPage && (
          <div className="p-3 border-t border-gray-200 flex items-center justify-center bg-gray-50">
            <button
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="px-3 py-1.5 text-xs rounded border border-primary-200 text-primary-600 hover:bg-primary-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isFetchingNextPage ? '加载中...' : '加载更多'}
            </button>
          </div>
        )}
      </div>

      {/* 左侧拖动分隔条：桌面专属；移动端改为单面板切换。 */}
      <div
        onMouseDown={handleMouseDown('left')}
        className="hidden w-1 cursor-col-resize items-center justify-center bg-[var(--surface-3)] transition-colors hover:bg-primary-500 lg:flex"
      >
        <GripVertical className="size-4 text-[var(--text-muted)]" />
      </div>

      {/* 第二列：新闻预览 */}
      <div
        style={{ '--panel-width': `${middleWidth}%` } as CSSProperties}
        className={`${mobilePane === 'preview' ? 'block' : 'hidden'} h-[calc(100dvh-10.5rem)] w-full overflow-y-auto rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-1)] shadow-[var(--shadow-soft)] lg:block lg:h-full lg:w-[var(--panel-width)] lg:rounded-none lg:border-x-0`}
      >
        <div className="p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-lg font-semibold text-gray-900">新闻预览</h3>
              <div className="inline-flex rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-1">
                <button
                  type="button"
                  onClick={() => setReviewMode('content')}
                  aria-pressed={reviewMode === 'content'}
                  className={`flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors ${reviewMode === 'content'
                    ? 'bg-[var(--surface-1)] text-[var(--text-primary)] shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
                >
                  <Newspaper className="size-3.5" /> 内容
                </button>
                <button
                  type="button"
                  onClick={() => setReviewMode('renderers')}
                  aria-pressed={reviewMode === 'renderers'}
                  className={`flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors ${reviewMode === 'renderers'
                    ? 'bg-[var(--agent-soft)] text-[var(--agent)] shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
                >
                  <GitCompareArrows className="size-3.5" /> Renderer A/B
                </button>
              </div>
            </div>
            {(currentRecord.rawContent?.link || currentRecord.processedContent?.link) && (
              <a
                href={currentRecord.rawContent?.link || currentRecord.processedContent?.link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center text-sm text-primary-600 hover:text-primary-700"
              >
                <ExternalLink className="w-4 h-4 mr-1" />
                查看原文
              </a>
            )}
          </div>

          {isNeuromancerEnhanced && (
            <div className="review-agent-card mb-4 rounded-xl p-3.5">
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--agent-soft)] text-[var(--agent)]">
                  <Sparkles className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-[var(--text-primary)]">Neuromancer 研究增强成品</p>
                    <span className="review-origin-badge">Agent final JSON</span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                    神经漫游者负责研究、取舍与成稿；Quote0 仅校验 Renderable contract、排版并推送到墨水屏。
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
                    <span>{currentRecord.contentOrigin?.contractVersion || currentRecord.processedContent?.metadata?.contractVersion || 'renderable contract'}</span>
                    <span>来源 · {currentRecord.processedContent?.source || currentRecord.dataSource}</span>
                    <span>{researchSources.length > 0 ? `研究凭证 · ${researchSources.length} 来源 / ${researchClaims.length} 主张` : provenanceCount > 0 ? `研究证据 ${provenanceCount} 项` : '研究来源明细尚未持久化'}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {isDetailLoading && (
            <div className="mb-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--text-muted)]">
              正在加载当前内容详情…列表本身已可交互。
            </div>
          )}

          {reviewMode === 'renderers' && (
            <div className="mb-5">
              <RendererComparisonView
                data={rendererComparison}
                targets={rendererTargets}
                targetId={rendererTargetId}
                onTargetChange={setRendererTargetId}
                isLoading={rendererComparisonLoading}
                error={rendererComparisonError instanceof Error ? rendererComparisonError : null}
              />
            </div>
          )}

          <div className="space-y-4">
            {/* 图片预览区域 - 顶置显示 */}
            {previewImagePath && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-xs font-medium text-gray-500 uppercase">
                    推送预览图（历史图片）
                  </label>
                  <button
                    onClick={handleRenderPreview}
                    disabled={renderMutation.isPending}
                    className="flex items-center px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ImageIcon className="w-3 h-3 mr-1.5" />
                    重新渲染
                  </button>
                </div>

                {renderMutation.isPending ? (
                  <div className="border border-gray-200 rounded-lg p-8 bg-gray-50 text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-2"></div>
                    <p className="text-sm text-gray-500">正在渲染图片...</p>
                  </div>
                ) : (
                  <div className="border border-gray-200 rounded-lg p-2 bg-gray-50">
                    <img
                      src={previewImagePath}
                      alt="新闻预览图"
                      className="w-full h-auto"
                      style={{ imageRendering: 'pixelated' }}
                    />
                    <p className="text-xs text-gray-500 mt-2 text-center">
                      296×152 像素 - 实际推送到设备的样式
                    </p>
                  </div>
                )}

                {renderMutation.isError && (
                  <div className="mt-2 text-xs text-red-600">
                    渲染失败: {(renderMutation.error as Error).message}
                  </div>
                )}
              </div>
            )}

            {currentRecord.rawContent?.description && !currentRecord.rawContent && !currentRecord.processedContent && (
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase">
                  摘要
                </label>
                <p className="mt-1 text-sm text-gray-700">
                  {currentRecord.rawContent?.description}
                </p>
              </div>
            )}

            {/* 原始RSS数据区域 */}
            {(currentRecord.rawContent || currentRecord.rawContent) && (
              <div className="mt-2">
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  {isNeuromancerEnhanced ? 'Renderable 输入快照' : '来源输入'}
                </label>
                <div className="review-source-card space-y-2 rounded-xl p-3.5">
                  <div>
                    <span className="text-xs font-semibold text-[var(--warning)]">输入标题</span>
                    <p className="mt-1 text-sm text-[var(--text-primary)]">
                      {(currentRecord.rawContent || currentRecord.rawContent)?.title}
                    </p>
                  </div>
                  {/* 显示原始正文：优先使用 raw_content.content，回退到 news.description */}
                  {((currentRecord.rawContent || currentRecord.rawContent)?.content || currentRecord.rawContent?.description) && (
                    <div>
                      <span className="text-xs font-semibold text-[var(--warning)]">
                        输入摘要 / 正文：
                        {(currentRecord.rawContent || currentRecord.rawContent)?.content
                          ? `（${(currentRecord.rawContent || currentRecord.rawContent).content.length} 字符）`
                          : '（RSS摘要）'}
                      </span>
                      <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-[var(--text-secondary)]">
                        {(currentRecord.rawContent || currentRecord.rawContent)?.content || currentRecord.rawContent?.description}
                      </p>
                    </div>
                  )}
                  {(currentRecord.rawContent || currentRecord.rawContent)?.description && (
                    <div>
                      <span className="text-xs font-semibold text-[var(--warning)]">Description</span>
                      <p className="mt-1 line-clamp-2 text-sm text-[var(--text-secondary)]">
                        {(currentRecord.rawContent || currentRecord.rawContent).description}
                      </p>
                    </div>
                  )}
                  <div className="text-xs text-[var(--text-muted)]">
                    来源 · {(currentRecord.rawContent || currentRecord.rawContent)?.source}　发布时间 · {(currentRecord.rawContent || currentRecord.rawContent)?.publishTime || '未知'}
                  </div>
                  {isNeuromancerEnhanced && provenanceCount === 0 && (
                    <p className="border-t border-[var(--border-subtle)] pt-2 text-xs leading-5 text-[var(--text-muted)]">
                      当前产物只保存最终成品快照；Neuromancer 检索 / crawl 的来源明细尚未随成品持久化，因此这里暂时不能完整回放“增强前 → 增强后”的证据链。
                    </p>
                  )}
                </div>
              </div>
            )}

            {isNeuromancerEnhanced && researchSources.length > 0 && (
              <div className="mt-2">
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  Neuromancer Research Receipt
                </label>
                <div className="space-y-3 rounded-xl border border-[color-mix(in_oklab,var(--agent)_22%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--agent)_5%,var(--surface-2))] p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
                      <span className="review-origin-badge">{researchReceipt?.schemaVersion || 'research receipt'}</span>
                      <span>{researchSources.length} 个来源</span>
                      <span>{researchClaims.length} 个主张</span>
                      {researchRetrieval?.status && <span>检索 · {researchRetrieval.status}</span>}
                    </div>
                    {researchReceipt?.threadId && (
                      <a
                        href={`https://profilmai.logic.heiyu.space/c/${researchReceipt.threadId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-[var(--agent)] hover:underline"
                      >
                        打开 Straylight thread
                      </a>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    {researchSources.map((source: any) => (
                      <a
                        key={source.id}
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-start gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-2.5 py-2 text-xs transition-colors hover:border-[color-mix(in_oklab,var(--agent)_35%,var(--border-subtle))]"
                      >
                        <span className="mt-0.5 shrink-0 rounded-md bg-[var(--agent-soft)] px-1.5 py-0.5 font-semibold text-[var(--agent)]">
                          {researchRoleLabel[source.role] || source.role}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-[var(--text-primary)]">{source.title || source.url}</span>
                          <span className="mt-0.5 block truncate text-[var(--text-muted)]">{source.url}</span>
                        </span>
                        <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-[var(--text-muted)]" />
                      </a>
                    ))}
                  </div>

                  {researchClaims.length > 0 && (
                    <div className="space-y-1.5 border-t border-[var(--border-subtle)] pt-2.5">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">最终主张 → 证据</p>
                      {researchClaims.map((claim: any, index: number) => (
                        <div key={`${claim.text}-${index}`} className="rounded-lg bg-[var(--surface-1)] px-2.5 py-2 text-xs">
                          <p className="leading-5 text-[var(--text-secondary)]">{claim.text}</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {(claim.sourceIds || []).map((sourceId: string) => (
                              <span key={sourceId} className="rounded-md bg-[var(--surface-3)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">{sourceId}</span>
                            ))}
                            <span className="rounded-md bg-[var(--agent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--agent)]">{claim.status}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {(researchUsage || researchRetrieval) && (
                    <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-[var(--border-subtle)] pt-2 text-[11px] text-[var(--text-muted)]">
                      {researchUsage?.toolCalls !== undefined && <span>工具调用 {researchUsage.toolCalls}</span>}
                      {researchUsage?.searchRequests !== undefined && <span>搜索 {researchUsage.searchRequests}</span>}
                      {researchUsage?.crawlRequests !== undefined && <span>Crawl {researchUsage.crawlRequests}</span>}
                      {researchUsage?.normalizedContextTokens !== undefined && <span>上下文估算 {researchUsage.normalizedContextTokens.toLocaleString()} tokens</span>}
                      {researchUsage?.providerReportedTokens?.status && (
                        <span>Provider tokens · {researchUsage.providerReportedTokens.status === 'reported' ? (researchUsage.providerReportedTokens.total ?? 'reported') : researchUsage.providerReportedTokens.status}</span>
                      )}
                      {Array.isArray(researchRetrieval?.enginesUsed) && researchRetrieval.enginesUsed.length > 0 && (
                        <span>引擎 · {researchRetrieval.enginesUsed.join(' / ')}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 处理后的数据区域 */}
            {(currentRecord.processedContent || currentRecord.processedContent) && (
              <div className="mt-2">
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  {isNeuromancerEnhanced ? 'Neuromancer 研究增强成品' : '处理后内容'}
                </label>
                <div className={`${isNeuromancerEnhanced ? 'review-agent-card' : 'review-enhanced-card'} space-y-2 rounded-xl p-3.5`}>
                  <div>
                    <span className="text-xs font-semibold text-[var(--agent)]">最终标题</span>
                    <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
                      {(currentRecord.processedContent || currentRecord.processedContent)?.title}
                    </p>
                  </div>
                  {(currentRecord.processedContent || currentRecord.processedContent)?.message && (
                    <div>
                      <span className="text-xs font-semibold text-[var(--agent)]">最终内容</span>
                      <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
                        {(currentRecord.processedContent || currentRecord.processedContent).message}
                      </p>
                    </div>
                  )}
                  {(currentRecord.processedContent || currentRecord.processedContent)?.signature && (
                    <div className="text-xs text-[var(--text-muted)]">
                      产出者 · {(currentRecord.processedContent || currentRecord.processedContent).signature}
                      {currentRecord.processedContent?.metadata?.contractVersion
                        ? `　Contract · ${currentRecord.processedContent.metadata.contractVersion}`
                        : ''}
                    </div>
                  )}
                  {Array.isArray(currentRecord.processedContent?.highlights) && currentRecord.processedContent.highlights.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 border-t border-[var(--border-subtle)] pt-2">
                      {currentRecord.processedContent.highlights.map((highlight: string) => (
                        <span key={highlight} className="rounded-full bg-[var(--surface-3)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
                          {highlight}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 text-xs text-gray-500">
              <div>
                <span className="font-medium">分类:</span> {currentRecord.category || '未知'}
              </div>
              <div>
                <span className="font-medium">数据源:</span> {currentRecord.dataSource || currentRecord.dataSource}
              </div>
              <div className="col-span-2">
                <span className="font-medium">推送时间:</span>{' '}
                {new Date(currentRecord.pushedAt).toLocaleString('zh-CN')}
              </div>
              {currentRecord.rawContent?.publishTime && (
                <div className="col-span-2">
                  <span className="font-medium">发布时间:</span>{' '}
                  {new Date(currentRecord.rawContent.publishTime).toLocaleString('zh-CN')}
                </div>
              )}
            </div>

          </div>
        </div>

        {currentRecord.annotationStatus === 'pending' && (
          <div className="sticky bottom-0 z-10 border-t border-[var(--border-subtle)] bg-[var(--surface-glass)] p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur-2xl lg:hidden">
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <button
                type="button"
                onClick={() => handleQuickAnnotate('like')}
                disabled={quickAnnotateMutation.isPending}
                className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--success-soft)] px-3 text-sm font-semibold text-[var(--success)] transition-transform active:scale-[0.98] disabled:opacity-50 motion-reduce:transform-none"
              >
                <ThumbsUp className="size-4" />
                高质量
              </button>
              <button
                type="button"
                onClick={() => handleQuickAnnotate('dislike')}
                disabled={quickAnnotateMutation.isPending}
                className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--danger-soft)] px-3 text-sm font-semibold text-[var(--danger)] transition-transform active:scale-[0.98] disabled:opacity-50 motion-reduce:transform-none"
              >
                <ThumbsDown className="size-4" />
                低质量
              </button>
              <button
                type="button"
                onClick={() => setMobilePane('actions')}
                className="grid size-12 place-items-center rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] text-[var(--text-secondary)] shadow-[var(--shadow-soft)] transition-transform active:scale-[0.96] motion-reduce:transform-none"
                aria-label="打开更多操作"
              >
                <SlidersHorizontal className="size-5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 右侧拖动分隔条：桌面专属。 */}
      <div
        onMouseDown={handleMouseDown('right')}
        className="hidden w-1 cursor-col-resize items-center justify-center bg-[var(--surface-3)] transition-colors hover:bg-primary-500 lg:flex"
      >
        <GripVertical className="size-4 text-[var(--text-muted)]" />
      </div>

      {/* 第三列：标注和调试信息 */}
      <div
        style={{ '--panel-width': `${100 - leftWidth - middleWidth}%` } as CSSProperties}
        className={`${mobilePane === 'actions' ? 'flex' : 'hidden'} h-[calc(100dvh-10.5rem)] w-full flex-col gap-4 overflow-y-auto lg:flex lg:h-full lg:w-[var(--panel-width)]`}
      >
        {/* 操作面板 */}
        <div className="review-panel rounded-2xl p-4 sm:p-6 lg:rounded-l-none">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">操作</h3>

          <div className="space-y-3">
            {reviewMode === 'renderers' && (
              <RendererReviewActions
                draft={rendererDraft}
                onChange={setRendererDraft}
                onSubmit={() => rendererReviewMutation.mutate()}
                isSaving={rendererReviewMutation.isPending}
                existingReview={rendererComparison?.review}
              />
            )}

            {/* 标注按钮（待标注状态） */}
            {currentRecord.annotationStatus === 'pending' && (
              <>
                <button
                  onClick={() => handleQuickAnnotate('like')}
                  disabled={quickAnnotateMutation.isPending}
                  className="quality-action quality-action-high min-h-16 disabled:cursor-not-allowed disabled:opacity-50"
                  title="点赞 / 高质量 (快捷键: W)"
                >
                  <span className="grid size-9 place-items-center rounded-lg bg-[var(--surface-1)] shadow-sm">
                    <ThumbsUp className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block text-sm font-semibold">高质量</span>
                    <span className="block text-xs text-[var(--text-secondary)]">内容准确、清晰、值得保留</span>
                  </span>
                  <kbd className="rounded-md bg-[var(--surface-3)] px-2 py-1 text-[11px] font-semibold text-[var(--text-muted)]">W</kbd>
                </button>
                <button
                  onClick={() => handleQuickAnnotate('dislike')}
                  disabled={quickAnnotateMutation.isPending}
                  className="quality-action quality-action-low min-h-16 disabled:cursor-not-allowed disabled:opacity-50"
                  title="点踩 / 低质量 (快捷键: S)"
                >
                  <span className="grid size-9 place-items-center rounded-lg bg-[var(--surface-1)] shadow-sm">
                    <ThumbsDown className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block text-sm font-semibold">低质量</span>
                    <span className="block text-xs text-[var(--text-secondary)]">事实、表达或内容价值不足</span>
                  </span>
                  <kbd className="rounded-md bg-[var(--surface-3)] px-2 py-1 text-[11px] font-semibold text-[var(--text-muted)]">S</kbd>
                </button>
                <button
                  onClick={handleSkip}
                  className="min-h-11 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] px-4 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                >
                  跳过 <span className="ml-1 text-xs text-[var(--text-muted)]">Space</span>
                </button>
              </>
            )}

            {/* 推送工作台：把“登记设备 → 选内容 → 推送”放在同一条路径上 */}
            <div className="review-enhanced-card rounded-xl p-3.5 text-sm text-[var(--text-primary)]">
              <p className="font-semibold">怎么开始推送</p>
              <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                左侧选一条新闻 → 选择目标设备 → 点击下方“立即推送”。设备管理页登记的墨水屏会自动出现在这里。
              </p>
            </div>

            <div className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3.5">
              <p className="text-sm font-semibold text-gray-800">推送目标</p>

              <label className="flex items-center text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={pushTarget.cloud}
                  onChange={e => setPushTarget(t => ({...t, cloud: e.target.checked}))}
                  className="mr-2"
                />
                ☁️ MindReset 云端
              </label>

              <div>
                <label className="flex items-center text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={pushTarget.esp32}
                    onChange={e => setPushTarget(t => ({...t, esp32: e.target.checked}))}
                    className="mr-2"
                  />
                  📟 本地墨水屏
                  {einkDevices.length > 0 && (
                    <span className="ml-1 text-xs text-gray-500">（{einkDevices.length} 台已启用）</span>
                  )}
                </label>

                {pushTarget.esp32 && (
                  <div className="ml-6 mt-2 space-y-2">
                    {devicesLoading && (
                      <p className="text-xs text-gray-500">正在读取已登记设备...</p>
                    )}
                    {devicesError && (
                      <p className="text-xs text-red-600">设备列表读取失败，请刷新页面重试。</p>
                    )}
                    {!devicesLoading && !devicesError && einkDevices.length === 0 && (
                      <div className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">
                        <p>还没有可推送的本地墨水屏。</p>
                        <Link to="/devices" className="mt-1 inline-block font-medium text-amber-900 underline">
                          去设备管理登记设备 →
                        </Link>
                      </div>
                    )}
                    {einkDevices.map((device) => {
                      const checked = selectedEinkDeviceIds === null || selectedEinkDeviceIds.includes(device.id);
                      return (
                        <label key={device.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-gray-50">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              const allIds = einkDevices.map((item) => item.id);
                              const currentIds = selectedEinkDeviceIds === null ? allIds : selectedEinkDeviceIds;
                              const nextIds = currentIds.includes(device.id)
                                ? currentIds.filter((id) => id !== device.id)
                                : [...currentIds, device.id];
                              setSelectedEinkDeviceIds(nextIds.length === allIds.length ? null : nextIds);
                            }}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-gray-800">{device.name}</span>
                            <span className="block truncate text-xs text-gray-500">{device.id} · {device.width}×{device.height}px</span>
                          </span>
                          {requestedDeviceId === device.id && (
                            <span className="text-xs font-medium text-primary-600">当前设备</span>
                          )}
                        </label>
                      );
                    })}
                    {einkDevices.length > 0 && (
                      <p className="text-xs text-gray-500">
                        {selectedEinkDeviceIds === null
                          ? '当前将推送到全部已勾选的本地墨水屏。'
                          : `当前已选择 ${selectedEinkDeviceIds.length} 台本地墨水屏。`}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <button
                onClick={handlePush}
                disabled={
                  pushMutation.isPending ||
                  (!pushTarget.cloud && !pushTarget.esp32) ||
                  (pushTarget.esp32 && einkDevices.length === 0 && !pushTarget.cloud) ||
                  (pushTarget.esp32 && selectedEinkDeviceIds !== null && selectedEinkDeviceIds.length === 0)
                }
                className="w-full flex items-center justify-center px-6 py-4 text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="w-6 h-6 mr-3" />
                <span className="font-medium text-lg">
                  {pushMutation.isPending ? '推送中...' : '立即推送这条新闻'}
                </span>
              </button>
            </div>

            {/* 已标注/跳过的提示 */}
            {currentRecord.annotationStatus === 'completed' && (
              <div className="text-sm text-green-600 text-center py-2 bg-green-50 rounded">
                ✅ 已完成标注
              </div>
            )}
            {currentRecord.annotationStatus === 'skipped' && (
              <div className="text-sm text-gray-600 text-center py-2 bg-gray-50 rounded">
                ⏭️ 已跳过此条
              </div>
            )}
          </div>

          {/* 导航按钮 */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="text-xs text-gray-500 text-center mb-3">
              💡 A 上一条 | D 下一条 | Space 跳过
            </div>
            <div className="flex items-center justify-between gap-3">
              <button
                onClick={handlePrevious}
                disabled={currentIdx <= 0}
                className="flex-1 flex items-center justify-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                上一条
              </button>
              <button
                onClick={handleNext}
                disabled={currentIdx >= filteredList.length - 1}
                className="flex-1 flex items-center justify-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                下一条
                <ChevronRight className="w-4 h-4 ml-1" />
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

export default AnnotationPage;
