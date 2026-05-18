import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { History, Type, ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import TextDesignPanel from '@/components/TextDesignPanel';
import ImageDesignPanel from '@/components/ImageDesignPanel';
import LabelCard from '@/components/LabelCard';
import { labelsApi } from '@/api/labels';

export default function DesignPage() {
  const navigate = useNavigate();
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

  const { data: recentLabels } = useQuery({
    queryKey: ['labels'],
    queryFn: () => labelsApi.list({ limit: 12 }),
    refetchInterval: 5000,
  });

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
              <TextDesignPanel />
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
