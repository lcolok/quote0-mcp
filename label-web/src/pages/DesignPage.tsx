import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { History, Type, ImageIcon, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PromptInput from '@/components/PromptInput';
import LabelPreview from '@/components/LabelPreview';
import ActionBar from '@/components/ActionBar';
import ImageDesignPanel from '@/components/ImageDesignPanel';
import LabelCard from '@/components/LabelCard';
import { labelsApi } from '@/api/labels';
import type { Label } from '@/types/label';

export default function DesignPage() {
  const navigate = useNavigate();
  const [label, setLabel] = useState<Label | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab: 'text' | 'image' = searchParams.get('tab') === 'image' ? 'image' : 'text';
  const setActiveTab = (tab: 'text' | 'image') => {
    const next = new URLSearchParams(searchParams);
    if (tab === 'text') {
      next.delete('tab');
    } else {
      next.set('tab', tab);
    }
    setSearchParams(next, { replace: false });
  };

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

  const { data: recentLabels } = useQuery({
    queryKey: ['labels'],
    queryFn: () => labelsApi.list({ limit: 12 }),
    refetchInterval: 5000,
  });

  const handleGenerate = (prompt: string) => {
    generateMutation.mutate({ prompt });
  };

  const handlePrint = () => {
    if (!label) return;
    printMutation.mutate({ id: label.id });
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
    deleteMutation.mutate(label.id);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Quote0 标签设计</h1>
        <Button variant="outline" onClick={() => navigate('/history')}>
          <History className="h-4 w-4 mr-2" />
          完整历史
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'text' | 'image')}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="text">
            <Type className="h-4 w-4 mr-1.5" />
            文字标签
          </TabsTrigger>
          <TabsTrigger value="image">
            <ImageIcon className="h-4 w-4 mr-1.5" />
            图像标签
          </TabsTrigger>
        </TabsList>
        <TabsContent value="text">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 space-y-6">
              <PromptInput onGenerate={handleGenerate} isLoading={generateMutation.isPending} />

              {generateMutation.isPending && (
                <div className="flex items-center justify-center py-12">
                  <div className="text-center space-y-3">
                    <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
                    <p className="text-sm text-muted-foreground">LLM 思考中…</p>
                  </div>
                </div>
              )}

              {!generateMutation.isPending && label && (
                <>
                  <div className="border-t border-border pt-6">
                    <h2 className="text-sm font-medium text-foreground mb-4">预览</h2>
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

            <aside className="lg:col-span-5">
              <div className="sticky top-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-medium text-foreground">最近标签</h2>
                  <span className="text-xs text-muted-foreground">每 5s 自动刷新</span>
                </div>
                {recentLabels && recentLabels.length > 0 ? (
                  <div className="grid grid-cols-2 gap-3 max-h-[80vh] overflow-y-auto pr-1">
                    {recentLabels.map((label) => (
                      <LabelCard key={label.id} label={label} />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-sm text-muted-foreground">
                    暂无标签
                  </div>
                )}
              </div>
            </aside>
          </div>
        </TabsContent>
        <TabsContent value="image">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 space-y-6">
              <ImageDesignPanel />
            </div>
            <aside className="lg:col-span-5">
              <div className="sticky top-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-medium text-foreground">最近标签</h2>
                  <span className="text-xs text-muted-foreground">每 5s 自动刷新</span>
                </div>
                {recentLabels && recentLabels.length > 0 ? (
                  <div className="grid grid-cols-2 gap-3 max-h-[80vh] overflow-y-auto pr-1">
                    {recentLabels.map((label) => (
                      <LabelCard key={label.id} label={label} />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-sm text-muted-foreground">
                    暂无标签
                  </div>
                )}
              </div>
            </aside>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
