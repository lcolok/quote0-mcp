import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { componentBatchesApi } from '@/api/component-batches';

export default function ComponentBatchCreatePage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [codesText, setCodesText] = useState('');

  const parsedCodes = codesText
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const createMut = useMutation({
    mutationFn: () => componentBatchesApi.create({ name: name.trim(), codes: parsedCodes }),
    onSuccess: (res) => {
      toast.success(`批次已创建，${res.count} 个编号`);
      navigate(`/batches/component/${res.id}`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? '创建失败'),
  });

  const canCreate = !!name.trim() && parsedCodes.length > 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" onClick={() => navigate('/batches')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          返回
        </Button>
        <h1 className="text-xl font-semibold text-foreground">新建元件标签批次</h1>
      </div>

      <Card className="p-6 space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">批次名称</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：2026-07-19 采购入库批次" />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">元件编号（每行一个）</label>
          <Textarea
            value={codesText}
            onChange={(e) => setCodesText(e.target.value)}
            placeholder={'C25168826\nC2925077\n10kΩ[0603]'}
            rows={10}
          />
          <p className="text-xs text-muted-foreground">
            {parsedCodes.length} 个编号 · 料号（如嘉立创 LCSC 编号）和数值+封装（如 10kΩ[0603]）都可以直接粘贴，每行一个
          </p>
        </div>

        <Button onClick={() => createMut.mutate()} disabled={!canCreate || createMut.isPending}>
          {createMut.isPending ? '创建中…' : '创建批次'}
        </Button>
      </Card>
    </div>
  );
}
