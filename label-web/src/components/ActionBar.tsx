import { Printer, RefreshCw, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

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
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" disabled={isPrinting}>
            <Printer className="h-4 w-4 mr-2" />
            {isPrinting ? '打印中...' : '打印'}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认打印？</AlertDialogTitle>
            <AlertDialogDescription>将向 niimbot 热敏标签机推送本标签。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={onPrint}>打印</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Button variant="outline" onClick={onRegenerate} disabled={isRegenerating}>
        <RefreshCw className={`h-4 w-4 mr-2 ${isRegenerating ? 'animate-spin' : ''}`} />
        {isRegenerating ? '重新生成中...' : '重新生成'}
      </Button>

      <Button variant="outline" onClick={onSave}>
        <Save className="h-4 w-4 mr-2" />
        保存
      </Button>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" disabled={isDeleting}>
            <Trash2 className="h-4 w-4 mr-2" />
            {isDeleting ? '丢弃中...' : '丢弃'}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认丢弃？</AlertDialogTitle>
            <AlertDialogDescription>此操作将删除当前标签，无法撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={onDiscard}>丢弃</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
