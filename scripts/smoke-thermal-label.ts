import { thermalLabelRenderer } from '../src/react-widgets/core/thermal-label-rendering-module.js';
import { LABEL_T40X20_TARGET } from '../src/react-widgets/core/render-targets.js';
import { fontRegistry } from '../src/react-widgets/core/font-registry.js';
import fs from 'fs';

// C. FontRegistry quick test
const fonts = await fontRegistry.getSatoriFonts(['smiley-sans']);
console.log('FontRegistry:', fonts.length, 'font(s) loaded');
console.log(
  'Font details:',
  fonts.map((f) => ({ name: f.name, bytes: f.data.byteLength, weight: f.weight, style: f.style }))
);

// A. Thermal label render
const out = await thermalLabelRenderer.render(
  { title: '会议室 A', subtitle: '2F-201' },
  LABEL_T40X20_TARGET
);

fs.writeFileSync('/tmp/test-label.png', out.pngBuffer);
fs.writeFileSync('/tmp/test-label.bin', out.bitmapBuffer);

console.log('PNG bytes:', out.pngBuffer.length);
console.log('BIN bytes:', out.bitmapBuffer.length);
console.log('Print ID:', out.printId);
console.log('Meta:', out.meta);
