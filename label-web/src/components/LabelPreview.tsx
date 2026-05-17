import type { Label } from '@/types/label';
import StatusBadge from './StatusBadge';

interface LabelPreviewProps {
  label: Label | null;
}

export default function LabelPreview({ label }: LabelPreviewProps) {
  if (!label) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 py-16">
        <p className="text-sm text-gray-400">预览区域</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-6 flex-wrap">
        <div className="shrink-0">
          <img
            src={label.pngUrl}
            alt={label.prompt}
            className="w-full max-w-[640px] aspect-[2/1] rounded-lg border border-gray-300 object-contain bg-white"
          />
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-gray-500">targetId:</span>
            <span className="font-mono text-gray-800">{label.targetId}</span>
          </div>
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
        </div>
      </div>
    </div>
  );
}
