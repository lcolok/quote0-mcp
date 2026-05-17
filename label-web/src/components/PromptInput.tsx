import { useState } from 'react';
import { Sparkles } from 'lucide-react';

interface PromptInputProps {
  onGenerate: (prompt: string) => void;
  isLoading: boolean;
}

export default function PromptInput({ onGenerate, isLoading }: PromptInputProps) {
  const [prompt, setPrompt] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isLoading) return;
    onGenerate(prompt.trim());
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label htmlFor="prompt" className="block text-sm font-medium text-gray-700">
        描述你想要的标签
      </label>
      <textarea
        id="prompt"
        rows={3}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="例: 会议室 A 门牌 / 番茄 9.9 元价签"
        className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200 resize-none"
      />
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isLoading || !prompt.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50 transition-all-smooth"
        >
          <Sparkles className="h-4 w-4" />
          {isLoading ? '生成中...' : '生成'}
        </button>
      </div>
    </form>
  );
}
