import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { History } from 'lucide-react';
import PromptInput from '@/components/PromptInput';
import LabelPreview from '@/components/LabelPreview';
import ActionBar from '@/components/ActionBar';
import { labelsApi } from '@/api/labels';
import type { Label } from '@/types/label';

export default function DesignPage() {
  const navigate = useNavigate();
  const [label, setLabel] = useState<Label | null>(null);

  const generateMutation = useMutation({
    mutationFn: labelsApi.generate,
    onSuccess: (data) => {
      setLabel({
        id: data.id,
        prompt: '',
        svg: data.svg,
        pngPath: data.pngUrl,
        pngUrl: data.pngUrl,
        targetId: 'label-T40x20-320',
        status: 'draft',
        printCount: 0,
        printHistory: [],
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      toast.success('标签生成成功');
    },
    onError: () => {
      toast.error('标签生成失败，请重试');
    },
  });

  const printMutation = useMutation({
    mutationFn: ({ id, req }: { id: string; req?: Parameters<typeof labelsApi.print>[1] }) =>
      labelsApi.print(id, req),
    onSuccess: () => {
      if (label) {
        setLabel({ ...label, status: 'printed', printCount: label.printCount + 1 });
      }
      toast.success('打印任务已发送');
    },
    onError: () => {
      toast.error('打印失败');
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: labelsApi.regenerate,
    onSuccess: (data) => {
      if (label) {
        setLabel({ ...label, svg: data.svg, pngPath: data.pngUrl, pngUrl: data.pngUrl });
      }
      toast.success('重新生成成功');
    },
    onError: () => {
      toast.error('重新生成失败');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: labelsApi.delete,
    onSuccess: () => {
      setLabel(null);
      toast.success('已丢弃');
    },
    onError: () => {
      toast.error('丢弃失败');
    },
  });

  const handleGenerate = (prompt: string) => {
    generateMutation.mutate({ prompt });
  };

  const handlePrint = () => {
    if (!label) return;
    if (window.confirm('确认打印此标签？')) {
      printMutation.mutate({ id: label.id });
    }
  };

  const handleRegenerate = () => {
    if (!label) return;
    regenerateMutation.mutate(label.id);
  };

  const handleSave = () => {
    toast.success('标签已保存（草稿）');
  };

  const handleDiscard = () => {
    if (!label) return;
    if (window.confirm('确认丢弃此标签？')) {
      deleteMutation.mutate(label.id);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Quote0 标签设计</h1>
        <button
          onClick={() => navigate('/history')}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all-smooth"
        >
          <History className="h-4 w-4" />
          历史
        </button>
      </div>

      <PromptInput onGenerate={handleGenerate} isLoading={generateMutation.isPending} />

      {generateMutation.isPending && (
        <div className="flex items-center justify-center py-12">
          <div className="text-center space-y-3">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
            <p className="text-sm text-gray-500">LLM 思考中…</p>
          </div>
        </div>
      )}

      {!generateMutation.isPending && label && (
        <>
          <div className="border-t border-gray-200 pt-6">
            <h2 className="text-sm font-medium text-gray-700 mb-4">预览</h2>
            <LabelPreview label={label} />
          </div>
          <ActionBar
            onPrint={handlePrint}
            onRegenerate={handleRegenerate}
            onSave={handleSave}
            onDiscard={handleDiscard}
            isPrinting={printMutation.isPending}
            isRegenerating={regenerateMutation.isPending}
            isDeleting={deleteMutation.isPending}
            hasLabel={!!label}
          />
        </>
      )}
    </div>
  );
}
