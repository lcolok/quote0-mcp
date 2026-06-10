import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { batchesApi } from '@/api/batches';
import { labelsApi } from '@/api/labels';

const MODELS = ['sd5', 'sd5-3k', 'nb2', 'nbp', 'gpt2'];
const NONE = '__none__';

export default function BatchCreatePage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [model, setModel] = useState('sd5');
  const [presetId, setPresetId] = useState(NONE);
  const [template, setTemplate] = useState('{{name}}');
  const [itemsText, setItemsText] = useState('');

  const { data: presets } = useQuery({ queryKey: ['presets'], queryFn: () => labelsApi.listPresets() });

  const parsedItems = itemsText
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const createMut = useMutation({
    mutationFn: () =>
      batchesApi.create({
        name: name.trim(),
        model,
        presetId: presetId === NONE ? null : presetId,
        promptTemplate: template,
        items: parsedItems.map((n) => ({ name: n })),
      }),
    onSuccess: (res) => {
      toast.success('批次已创建');
      navigate(`/batches/${res.id}`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? '创建失败'),
  });

  const canCreate = !!name.trim() && !!template.trim() && parsedItems.length > 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" onClick={() => navigate('/batches')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          返回
        </Button>
        <h1 className="text-xl font-semibold">新建批次</h1>
      </div>

      <Card className="p-6 space-y-4">
        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">批次名称</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：潮流玩具盲盒分类标签" />
        </div>

        <div className="flex gap-4">
          <div className="space-y-1 flex-1">
            <label className="text-sm text-muted-foreground">AI 模型</label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODELS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 flex-1">
            <label className="text-sm text-muted-foreground">风格预设（可选）</label>
            <Select value={presetId} onValueChange={setPresetId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>系统默认</SelectItem>
                {(presets ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">{'提示词模板（用 {{name}} 引用系列名）'}</label>
          <Textarea value={template} onChange={(e) => setTemplate(e.target.value)} rows={3} placeholder="{{name}} 盲盒系列" />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">系列清单（每行一个，共 {parsedItems.length} 个）</label>
          <Textarea
            value={itemsText}
            onChange={(e) => setItemsText(e.target.value)}
            rows={10}
            placeholder={'2025芝麻街\n2024哈利波特行李箱系列\n2026monchhichi'}
          />
        </div>

        <Button disabled={!canCreate || createMut.isPending} onClick={() => createMut.mutate()}>
          {createMut.isPending ? '创建中…' : `创建批次（${parsedItems.length} 个系列）`}
        </Button>
      </Card>
    </div>
  );
}
