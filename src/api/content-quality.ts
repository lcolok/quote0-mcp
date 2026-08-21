export const CONTENT_QUALITY_POLICY_VERSION = 'content-quality/v2';

export type EvidenceSufficiency = 'insufficient' | 'limited' | 'sufficient';
export type EvidenceMode = 'seed-only' | 'sparse' | 'adequate';
export type ContentQualityDisposition = 'deliver' | 'review' | 'hold';

export interface SourceEvidenceAssessment {
  policyVersion: string;
  mode: EvidenceMode;
  sufficiency: EvidenceSufficiency;
  evidenceChars: number;
  semanticChars: number;
  evidenceAtoms: number;
  hardFactCount: number;
  bodyNoveltyRatio: number;
  placeholderOnly: boolean;
  reasons: string[];
}

export interface ProducedContentQualityAssessment extends SourceEvidenceAssessment {
  disposition: ContentQualityDisposition;
  recommendation: 'direct' | 'research-required' | 'research-recommended' | 'human-review';
  unsupportedHardFacts: string[];
  outputTitleChars: number;
  outputMessageChars: number;
}

const PLACEHOLDER_PATTERNS = [
  /^点击查看原文[>》]?$/i,
  /^查看原文[>》]?$/i,
  /^阅读全文[>》]?$/i,
  /^read more[>.…]*$/i,
  /^continue reading[>.…]*$/i,
];

const TRAILING_BOILERPLATE_PATTERNS = [
  /(?:\s|^)(?:点击查看原文|查看原文|阅读全文)[>》]?\s*$/iu,
  /(?:\s|^)(?:read more|continue reading)[>.…]*\s*$/iu,
];

function cleanText(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim()
    : '';
}

function stripBoilerplate(value: unknown): { text: string; placeholderOnly: boolean } {
  const raw = cleanText(value);
  if (!raw) return { text: '', placeholderOnly: false };
  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(raw))) {
    return { text: '', placeholderOnly: true };
  }
  let text = raw;
  let changed = false;
  for (const pattern of TRAILING_BOILERPLATE_PATTERNS) {
    const next = text.replace(pattern, '').trim();
    if (next !== text) {
      text = next;
      changed = true;
    }
  }
  return { text, placeholderOnly: changed && !text };
}

function normalizeLexical(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}

function bigrams(value: string): Set<string> {
  const chars = [...normalizeLexical(value)];
  const grams = new Set<string>();
  if (chars.length < 2) {
    if (chars[0]) grams.add(chars[0]);
    return grams;
  }
  for (let index = 0; index < chars.length - 1; index += 1) {
    grams.add(`${chars[index]}${chars[index + 1]}`);
  }
  return grams;
}

function noveltyRatio(title: string, body: string): number {
  const bodyGrams = bigrams(body);
  if (bodyGrams.size === 0) return 0;
  const titleGrams = bigrams(title);
  let novel = 0;
  for (const gram of bodyGrams) {
    if (!titleGrams.has(gram)) novel += 1;
  }
  return novel / bodyGrams.size;
}

function evidenceSegments(value: string): string[] {
  return value
    // Split CJK punctuation and English sentence stops followed by whitespace.
    // Do not split bare dots so versions (1.27), decimals and hostnames remain intact.
    .split(/[。！？!?；;\n]+|\.\s+/u)
    .map((segment) => cleanText(segment))
    .filter((segment) => [...normalizeLexical(segment)].length >= 4);
}

function dedupeBodies(...values: unknown[]): { text: string; placeholderOnly: boolean } {
  const seen = new Set<string>();
  const parts: string[] = [];
  let placeholderOnly = false;
  for (const value of values) {
    const stripped = stripBoilerplate(value);
    placeholderOnly = placeholderOnly || stripped.placeholderOnly;
    if (!stripped.text) continue;
    const key = normalizeLexical(stripped.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    parts.push(stripped.text);
  }
  return { text: parts.join('\n'), placeholderOnly };
}

export function assessSourceEvidence(input: {
  title?: unknown;
  content?: unknown;
  description?: unknown;
}): SourceEvidenceAssessment {
  const title = cleanText(input.title);
  const body = dedupeBodies(input.content, input.description);
  const semanticChars = [...normalizeLexical(body.text)].length;
  const rawEvidenceChars = Math.max(cleanText(input.content).length, cleanText(input.description).length);
  const atoms = evidenceSegments(body.text);
  const hardFactCount = extractHardFacts(body.text).length;
  const bodyNoveltyRatio = noveltyRatio(title, body.text);
  const reasons: string[] = [];

  // `seed-only` means there is no proposition beyond the headline/boilerplate. This is
  // intentionally NOT a character-count rule: a short but meaningful fact becomes sparse,
  // while a long body that merely repeats the title can still be seed-only.
  const noSemanticBody = semanticChars === 0;
  const normalizedTitle = normalizeLexical(title);
  const normalizedBody = normalizeLexical(body.text);
  const repeatedHeadline = Boolean(
    normalizedTitle
      && normalizedBody.length >= normalizedTitle.length
      && normalizedBody.split(normalizedTitle).join('').length === 0,
  );
  const restatesTitle = !noSemanticBody && (
    repeatedHeadline
    || (atoms.length <= 1 && hardFactCount === 0 && bodyNoveltyRatio < 0.08)
  );

  let mode: EvidenceMode;
  if (noSemanticBody || restatesTitle) {
    mode = 'seed-only';
    reasons.push(noSemanticBody ? 'no-semantic-body' : 'body-restates-title');
  } else {
    const sparse = atoms.length <= 1
      || (atoms.length <= 2 && hardFactCount === 0 && bodyNoveltyRatio < 0.35);
    mode = sparse ? 'sparse' : 'adequate';
    if (sparse) {
      if (atoms.length <= 1) reasons.push('single-evidence-atom');
      if (bodyNoveltyRatio < 0.35) reasons.push('low-novelty-vs-title');
    }
  }

  if (body.placeholderOnly) reasons.push('source-body-boilerplate-only');

  const sufficiency: EvidenceSufficiency = mode === 'seed-only'
    ? 'insufficient'
    : mode === 'sparse'
      ? 'limited'
      : 'sufficient';

  return {
    policyVersion: CONTENT_QUALITY_POLICY_VERSION,
    mode,
    sufficiency,
    evidenceChars: rawEvidenceChars,
    semanticChars,
    evidenceAtoms: atoms.length,
    hardFactCount,
    bodyNoveltyRatio: Number(bodyNoveltyRatio.toFixed(4)),
    placeholderOnly: body.placeholderOnly,
    reasons,
  };
}

interface HardFact {
  type: 'year' | 'percent' | 'currency' | 'version' | 'measured-count';
  value: string;
}

function normalizeHardFact(value: string): string {
  return value
    .toLowerCase()
    .replace(/[，,]/g, '')
    .replace(/\s+/g, '');
}

function normalizeCurrencyFact(raw: string): string {
  const compact = normalizeHardFact(raw);
  const currency = compact.startsWith('₹') || compact.endsWith('卢比')
    ? 'inr'
    : compact.startsWith('€') || compact.endsWith('欧元')
      ? 'eur'
      : compact.startsWith('£') || compact.endsWith('英镑')
        ? 'gbp'
        : compact.startsWith('$') || compact.endsWith('美元') || compact.endsWith('美金')
          ? 'usd'
          : 'cny';
  const numeric = Number.parseFloat(compact.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(numeric)) return compact;
  const multiplier = /(?:亿元|亿)$/.test(compact)
    ? 100_000_000
    : /(?:万元|万)$/.test(compact)
      ? 10_000
      : /[bB]$/.test(raw.trim())
        ? 1_000_000_000
        : /[mM]$/.test(raw.trim())
          ? 1_000_000
          : /[kK]$/.test(raw.trim())
            ? 1_000
            : 1;
  return `${currency}:${Math.round(numeric * multiplier)}`;
}

function collectMatches(text: string, type: HardFact['type'], regex: RegExp, facts: HardFact[]): void {
  for (const match of text.matchAll(regex)) {
    const raw = match[0]?.trim();
    if (!raw) continue;
    facts.push({ type, value: normalizeHardFact(raw) });
  }
}

export function extractHardFacts(value: unknown): HardFact[] {
  const text = cleanText(value);
  if (!text) return [];
  const facts: HardFact[] = [];

  collectMatches(text, 'year', /\b(?:19|20)\d{2}\b/g, facts);
  collectMatches(text, 'percent', /\b\d+(?:\.\d+)?\s*%/g, facts);
  for (const match of text.matchAll(
    /(?:[$€£¥￥₹]\s*\d[\d,.]*(?:\.\d+)?(?:\s*(?:[kKmMbB]|万|亿))?|\d[\d,.]*(?:\.\d+)?\s*(?:美元|美金|人民币|元|亿元|万元|卢比|欧元|英镑))/g,
  )) {
    const raw = match[0]?.trim();
    if (raw) facts.push({ type: 'currency', value: normalizeCurrencyFact(raw) });
  }
  collectMatches(text, 'version', /\bv?\d+\.\d+(?:\.\d+){0,2}(?:[-_a-zA-Z0-9.]*)?/g, facts);
  collectMatches(
    text,
    'measured-count',
    /\b\d+(?:\.\d+)?\s*(?:倍|个|家|项|条|人|社区|国家|地区|模型|分钟|小时|天|GB|MB|TB|points?|comments?|reviews?)\b/gi,
    facts,
  );

  const unique = new Map<string, HardFact>();
  for (const fact of facts) unique.set(`${fact.type}:${fact.value}`, fact);
  return [...unique.values()];
}

function unsupportedHardFacts(evidence: string, output: string): string[] {
  const evidenceFacts = new Set(extractHardFacts(evidence).map((fact) => `${fact.type}:${fact.value}`));
  return extractHardFacts(output)
    .filter((fact) => !evidenceFacts.has(`${fact.type}:${fact.value}`))
    .map((fact) => `${fact.type}:${fact.value}`);
}

export function assessProducedContentQuality(
  raw: {
    title?: unknown;
    content?: unknown;
    description?: unknown;
  },
  processed: {
    title?: unknown;
    message?: unknown;
    summary?: unknown;
  },
): ProducedContentQualityAssessment {
  const source = assessSourceEvidence(raw);
  const outputTitle = cleanText(processed.title);
  const outputMessage = cleanText(processed.message) || cleanText(processed.summary);
  const evidenceText = [cleanText(raw.title), cleanText(raw.content), cleanText(raw.description)]
    .filter(Boolean)
    .join('\n');
  const outputText = [outputTitle, outputMessage].filter(Boolean).join('\n');
  const novelFacts = unsupportedHardFacts(evidenceText, outputText);
  const reasons = [...source.reasons];

  if (!outputTitle || !outputMessage) reasons.push('generated-content-incomplete');
  if (novelFacts.length > 0) reasons.push('unsupported-hard-fact');
  if (outputTitle.length > 24) reasons.push('title-too-long');
  if (outputMessage.length > 180) reasons.push('message-too-long');

  let disposition: ContentQualityDisposition = 'deliver';
  let recommendation: ProducedContentQualityAssessment['recommendation'] = 'direct';

  if (source.mode === 'seed-only' || !outputTitle || !outputMessage || novelFacts.length > 0) {
    disposition = 'hold';
    recommendation = 'research-required';
  } else if (source.mode === 'sparse') {
    disposition = 'review';
    recommendation = 'research-recommended';
  } else if (outputTitle.length > 24 || outputMessage.length > 180) {
    disposition = 'review';
    recommendation = 'human-review';
  }

  return {
    ...source,
    disposition,
    recommendation,
    reasons: [...new Set(reasons)],
    unsupportedHardFacts: novelFacts,
    outputTitleChars: outputTitle.length,
    outputMessageChars: outputMessage.length,
  };
}

function contentQualityMetadata(processedContent: unknown): Record<string, unknown> | undefined {
  if (!processedContent || typeof processedContent !== 'object' || Array.isArray(processedContent)) return undefined;
  const metadata = (processedContent as Record<string, unknown>).metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  const quality = (metadata as Record<string, unknown>).contentQuality;
  return quality && typeof quality === 'object' && !Array.isArray(quality)
    ? quality as Record<string, unknown>
    : undefined;
}

export function contentQualityResearchPriority(processedContent: unknown): 0 | 1 | 2 {
  const quality = contentQualityMetadata(processedContent);
  if (!quality) return 0;
  if (quality.disposition === 'hold' && quality.recommendation === 'research-required') return 2;
  if (quality.recommendation === 'research-recommended') return 1;
  return 0;
}

export function isContentQualityHold(processedContent: unknown): boolean {
  return contentQualityResearchPriority(processedContent) === 2;
}
