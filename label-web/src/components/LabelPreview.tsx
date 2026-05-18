import { Card } from '@/components/ui/card';
import type { Label } from '@/types/label';
import StatusBadge from './StatusBadge';

interface LabelPreviewProps {
  label: Label | null;
}

export default function LabelPreview({ label }: LabelPreviewProps) {
  if (!label) {
    return (
      <Card className="flex items-center justify-center py-16 border-dashed">
        <p className="text-sm text-muted-foreground">预览区域</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-6 flex-wrap">
        <div className="shrink-0">
          <img
            src={label.pngUrl}
            alt={label.prompt}
            className="w-full max-w-[640px] aspect-[2/1] rounded-lg border border-border object-contain bg-background"
          />
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">targetId:</span>
            <span className="font-mono text-foreground">{label.targetId}</span>
          </div>
          {label.llmModel && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">LLM:</span>
              <span className="text-foreground">{label.llmModel}</span>
            </div>
          )}
          {typeof label.llmLatencyMs === 'number' && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Latency:</span>
              <span className="text-foreground">{(label.llmLatencyMs / 1000).toFixed(1)}s</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Status:</span>
            <StatusBadge status={label.status} />
          </div>
        </div>
      </div>
    </div>
  );
}
