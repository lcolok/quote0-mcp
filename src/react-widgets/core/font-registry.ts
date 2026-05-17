import fs from 'fs';
import path from 'path';

export interface SatoriFontEntry {
  name: string;
  data: ArrayBuffer;
  weight: number;
  style: string;
}

class FontRegistry {
  private cache = new Map<string, SatoriFontEntry[]>();
  private fontsDir = path.resolve(process.cwd(), 'assets/fonts');

  async getSatoriFonts(stack: string[]): Promise<SatoriFontEntry[]> {
    const result: SatoriFontEntry[] = [];
    for (const family of stack) {
      const cached = this.cache.get(family);
      if (cached) {
        result.push(...cached);
        continue;
      }
      const loaded = await this.loadFamily(family);
      this.cache.set(family, loaded);
      result.push(...loaded);
    }
    return result;
  }

  private async loadFamily(family: string): Promise<SatoriFontEntry[]> {
    const familyDir = path.join(this.fontsDir, family);
    if (!fs.existsSync(familyDir)) {
      console.warn(`⚠️ Font family directory not found: ${familyDir}`);
      return [];
    }

    const entries = await fs.promises.readdir(familyDir);
    const fontFiles = entries.filter(
      (f) => f.endsWith('.ttf') || f.endsWith('.otf')
    );

    const fonts: SatoriFontEntry[] = [];
    for (const file of fontFiles) {
      const filePath = path.join(familyDir, file);
      const buffer = await fs.promises.readFile(filePath);
      const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

      const lower = file.toLowerCase();
      const style = lower.includes('oblique') || lower.includes('italic') ? 'oblique' : 'normal';

      // Infer weight from filename; default to 400
      let weight = 400;
      const weightMatch = lower.match(/-(thin|extralight|light|regular|normal|medium|semibold|bold|extrabold|black)|(\d{3,4})/);
      if (weightMatch) {
        const w = weightMatch[1] || weightMatch[2];
        const weightMap: Record<string, number> = {
          thin: 100, extralight: 200, light: 300,
          regular: 400, normal: 400, medium: 500,
          semibold: 600, bold: 700, extrabold: 800, black: 900,
        };
        if (w && weightMap[w]) weight = weightMap[w];
        else if (w && /^\d+$/.test(w)) weight = parseInt(w, 10);
      }

      fonts.push({ name: family, data, weight, style });
    }

    return fonts;
  }
}

export const fontRegistry = new FontRegistry();
