import { describe, expect, test } from 'bun:test';

const ADAPTIVE_V2_VISUAL_SMOKE = String.raw`
import sharp from 'sharp';
import { renderableNewsToAdaptiveDocument } from './src/react-widgets/core/adaptive-document-adapters.ts';
import { planAdaptiveLayout } from './src/react-widgets/core/adaptive-layout.ts';
import { renderAdaptiveDocumentWithSatori } from './src/react-widgets/core/adaptive-satori-renderer.tsx';
import { EINK_TARGET } from './src/react-widgets/core/render-targets.ts';

const data = {
  id: 'visual-1',
  title: 'Adaptive v2继承A的视觉语法',
  message: '新的自适应布局保留黑底标题视觉锚点，让正文主动使用剩余空间，并把来源栏固定到底部。这样多尺寸适配仍然由 RenderTarget 驱动，但成熟的阅读层级不会因为自适应而被丢掉。',
  signature: 'AI优化·Q95',
  source: 'Quote0',
  publishTime: '2026-08-18T00:00:00Z',
  category: 'news',
};

function regionMean(data, width, y0, y1) {
  let sum = 0;
  let count = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = 0; x < width; x += 1) {
      sum += data[y * width + x] ?? 255;
      count += 1;
    }
  }
  return count > 0 ? sum / count : 255;
}

function darkPixels(data, width, y0, y1) {
  let count = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((data[y * width + x] ?? 255) < 128) count += 1;
    }
  }
  return count;
}

const document = renderableNewsToAdaptiveDocument(data);
const plan = planAdaptiveLayout(document, EINK_TARGET);
const rendered = await renderAdaptiveDocumentWithSatori(document, EINK_TARGET, plan);
const raw = await sharp(rendered.pngBuffer).greyscale().raw().toBuffer({ resolveWithObject: true });
if (raw.info.width !== 296 || raw.info.height !== 152 || raw.info.channels !== 1) {
  throw new Error('unexpected image geometry: ' + JSON.stringify(raw.info));
}
if (plan.visualGrammar.titleTreatment !== 'inverse-banner') throw new Error('title treatment regressed');
if (plan.visualGrammar.footerTreatment !== 'bottom-rule') throw new Error('footer treatment regressed');
const titleHeight = plan.regions.titleBanner.heightPx;
const footerHeight = plan.regions.footer.heightPx;
const titleMean = regionMean(raw.data, raw.info.width, 0, titleHeight);
const bodyMean = regionMean(raw.data, raw.info.width, titleHeight, raw.info.height - footerHeight);
const footerInk = darkPixels(raw.data, raw.info.width, raw.info.height - footerHeight, raw.info.height);
if (!(titleMean < 120)) throw new Error('title banner not dark enough: ' + titleMean);
if (!(bodyMean > 210)) throw new Error('body surface not light enough: ' + bodyMean);
if (!(footerInk > 20)) throw new Error('footer is not anchored with visible ink: ' + footerInk);
console.log('ADAPTIVE_V2_VISUAL_OK=' + JSON.stringify({ titleMean, bodyMean, footerInk, bodyVisibleLines: plan.bodyVisibleLines }));
`;

describe('Adaptive Satori v2 Current-inspired visual grammar', () => {
  test('real output contains a dark title banner, white body surface and anchored footer ink in an isolated process', async () => {
    const child = Bun.spawn(['bun', '-e', ADAPTIVE_V2_VISUAL_SMOKE], {
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain('panicked');
    expect(stdout).toContain('ADAPTIVE_V2_VISUAL_OK=');
  });
});
