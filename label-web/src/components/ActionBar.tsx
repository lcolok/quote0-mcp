import { Printer, RefreshCw, Save, Trash2 } from 'lucide-react';

interface ActionBarProps {
  onPrint: () => void;
  onRegenerate: () => void;
  onSave: () => void;
  onDiscard: () => void;
  isPrinting?: boolean;
  isRegenerating?: boolean;
  isDeleting?: boolean;
  hasLabel: boolean;
}

export default function ActionBar({
  onPrint,
  onRegenerate,
  onSave,
  onDiscard,
  isPrinting,
  isRegenerating,
  isDeleting,
  hasLabel,
}: ActionBarProps) {
  if (!hasLabel) return null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={onPrint}
        disabled={isPrinting}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-all-smooth"
      >
        <Printer className="h-4 w-4" />
        {isPrinting ? '打印中...' : '打印'}
      </button>
      <button
        onClick={onRegenerate}
        disabled={isRegenerating}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-all-smooth"
      >
        <RefreshCw className={`h-4 w-4 ${isRegenerating ? 'animate-spin' : ''}`} />
        {isRegenerating ? '重新生成中...' : '重新生成'}
      </button>
      <button
        onClick={onSave}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all-smooth"
      >
        <Save className="h-4 w-4" />
        保存
      </button>
      <button
        onClick={onDiscard}
        disabled={isDeleting}
        className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition-all-smooth"
      >
        <Trash2 className="h-4 w-4" />
        {isDeleting ? '丢弃中...' : '丢弃'}
      </button>
    </div>
  );
}
