import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Printer, RefreshCw, Archive, ImageIcon } from 'lucide-react';
import { labelsApi } from '@/api/labels';
import StatusBadge from '@/components/StatusBadge';

export default function DetailPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const from = searchParams.get('from');
  const tabFromQuery = searchParams.get('tab');

  const backPath = (() => {
    if (from === 'design') {
      return tabFromQuery ? `/?tab=${tabFromQuery}` : '/';
    }
    if (from === 'history') {
      return '/history';
    }
    return '/history';
  })();

  const backLabel = from === 'design' ? '设计' : '历史';

  const { data: label, isLoading, refetch } = useQuery({
    queryKey: ['label', id],
    queryFn: () => labelsApi.get(id!),
    enabled: !!id,
  });

  const printMutation = useMutation({
    mutationFn: ({ lid, req }: { lid: string; req?: Parameters<typeof labelsApi.print>[1] }) =>
      labelsApi.print(lid, req),
    onSuccess: () => {
      toast.success('打印任务已发送');
      refetch();
    },
    onError: () => {
      toast.error('打印失败');
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: labelsApi.regenerate,
    onSuccess: () => {
      toast.success('重新生成成功');
      refetch();
    },
    onError: () => {
      toast.error('重新生成失败');
    },
  });

  const reditherMutation = useMutation({
    mutationFn: () => labelsApi.redither(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['label', id] });
      toast.success('重新 dither 完成');
    },
    onError: () => {
      toast.error('重新 dither 失败');
    },
  });

  const archiveMutation = useMutation({
    mutationFn: labelsApi.delete,
    onSuccess: () => {
      toast.success('已归档（删除）');
      navigate(backPath);
    },
    onError: () => {
      toast.error('归档失败');
    },
  });

  const handlePrint = () => {
    if (!label) return;
    if (window.confirm('确认重新打印此标签？')) {
      printMutation.mutate({ lid: label.id });
    }
  };

  const handleRegenerate = () => {
    if (!label) return;
    regenerateMutation.mutate(label.id);
  };

  const handleRedither = () => {
    if (!label) return;
    reditherMutation.mutate();
  };

  const handleArchive = () => {
    if (!label) return;
    if (window.confirm('确认归档此标签？')) {
      archiveMutation.mutate(label.id);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
      </div>
    );
  }

  if (!label) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6 text-center text-gray-500">
        标签不存在
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 space-y-6">
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate(backPath)}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all-smooth"
        >
          <ArrowLeft className="h-4 w-4" />
          {backLabel}
        </button>
        <h1 className="text-xl font-semibold text-gray-900">标签详情</h1>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <div>
          <span className="text-sm text-gray-500">Prompt:</span>
          <p className="mt-1 text-base font-medium text-gray-900">{label.prompt}</p>
        </div>

        <div className="flex flex-col md:flex-row gap-6">
          <div className="shrink-0 space-y-3">
            <img
              src={label.pngUrl}
              alt={label.prompt}
              className="w-full max-w-[480px] aspect-[2/1] rounded-lg border border-gray-300 object-contain bg-white"
            />
            {label.sourceType === 'image' && label.sourceImageUrl && (
              <div>
                <span className="text-xs text-gray-500 mb-1 block">AI 原图</span>
                <img
                  src={label.sourceImageUrl}
                  alt="AI 原图"
                  className="w-full max-w-[480px] rounded-lg border border-gray-200 object-contain bg-gray-50"
                />
              </div>
            )}
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-gray-500">targetId:</span>
              <span className="font-mono text-gray-800">{label.targetId}</span>
            </div>
            {label.sourceType && (
              <div className="flex items-center gap-2">
                <span className="text-gray-500">来源:</span>
                <span className="inline-flex items-center gap-1 text-gray-800">
                  {label.sourceType === 'image' && <ImageIcon className="h-3 w-3 text-purple-600" />}
                  {label.sourceType === 'image' ? '图像（AI）' : label.sourceType}
                </span>
              </div>
            )}
            {label.sourceModel && (
              <div className="flex items-center gap-2">
                <span className="text-gray-500">模型:</span>
                <span className="text-gray-800">{label.sourceModel}</span>
              </div>
            )}
            {label.llmModel && (
              <div className="flex items-center gap-2">
                <span className="text-gray-500">LLM:</span>
                <span className="text-gray-800">{label.llmModel}</span>
              </div>
            )}
            {typeof label.llmLatencyMs === 'number' && (
              <div className="flex items-center gap-2">
                <span className="text-gray-500">Latency:</span>
                <span className="text-gray-800">{(label.llmLatencyMs / 1000).toFixed(1)}s</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-gray-500">Status:</span>
              <StatusBadge status={label.status} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">Print Count:</span>
              <span className="text-gray-800">{label.printCount}</span>
            </div>
            {label.tags.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-gray-500">Tags:</span>
                <span className="text-gray-800">{label.tags.join(', ')}</span>
              </div>
            )}
          </div>
        </div>

        {label.printHistory.length > 0 && (
          <div className="border-t border-gray-100 pt-4">
            <h3 className="text-sm font-medium text-gray-700 mb-2">打印历史</h3>
            <ul className="space-y-1 text-sm text-gray-600">
              {label.printHistory.map((p, idx) => (
                <li key={idx}>
                  • {new Date(p.printedAt).toLocaleString('zh-CN')} → niimbot @ {p.niimbotEndpoint} (HTTP{' '}
                  {p.httpStatus})
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            onClick={handlePrint}
            disabled={printMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-all-smooth"
          >
            <Printer className="h-4 w-4" />
            {printMutation.isPending ? '打印中...' : '重新打印'}
          </button>
          <button
            onClick={handleRegenerate}
            disabled={regenerateMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-all-smooth"
          >
            <RefreshCw className={`h-4 w-4 ${regenerateMutation.isPending ? 'animate-spin' : ''}`} />
            {regenerateMutation.isPending ? '重新生成中...' : '重新生成'}
          </button>
          {label.sourceType === 'image' && (
            <button
              onClick={handleRedither}
              disabled={reditherMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-all-smooth"
              title="不重新调 AI，仅重新 dither"
            >
              <RefreshCw className={`h-4 w-4 ${reditherMutation.isPending ? 'animate-spin' : ''}`} />
              {reditherMutation.isPending ? '重新 dither 中...' : '重新 dither'}
            </button>
          )}
          <button
            onClick={handleArchive}
            disabled={archiveMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg border border-yellow-200 bg-white px-4 py-2 text-sm font-medium text-yellow-700 hover:bg-yellow-50 disabled:opacity-50 transition-all-smooth"
          >
            <Archive className="h-4 w-4" />
            {archiveMutation.isPending ? '归档中...' : '归档'}
          </button>
        </div>
      </div>
    </div>
  );
}
