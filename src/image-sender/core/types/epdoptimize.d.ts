declare module 'epdoptimize' {
  interface DitheringOptions {
    algorithm?: string;
    ditheringType?: string;
    palette?: string | number[][];
    [key: string]: any;
  }

  export function ditherImage(
    inputCanvas: HTMLCanvasElement | any,
    outputCanvas: HTMLCanvasElement | any,
    options: DitheringOptions
  ): void;

  export function getDefaultPalettes(paletteType: string): string[];
}