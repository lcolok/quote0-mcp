import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as vm from 'node:vm';

const DANGEROUS_IDENTIFIERS = new Set([
  'eval', 'Function', 'require', 'module', 'exports',
  'process', 'global', 'globalThis', 'window', 'self',
  '__dirname', '__filename', '__proto__', 'constructor',
  'setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval',
  'fetch', 'XMLHttpRequest', 'Request', 'Response', 'Buffer',
  'fs', 'net', 'http', 'https', 'crypto', 'os', 'child_process', 'worker_threads',
  'queueMicrotask', 'structuredClone',
  'import',
]);

const FORBIDDEN_NODE_TYPES = new Set([
  'ImportDeclaration', 'ImportExpression', 'ExportNamedDeclaration', 'ExportDefaultDeclaration', 'ExportAllDeclaration',
  'AwaitExpression', 'YieldExpression', 'WithStatement',
  'MetaProperty',
]);

const FORBIDDEN_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

export interface DecoratorContext {
  width: number;
  height: number;
  safeZone: { x: number; y: number; w: number; h: number };
  corners: Array<{ x: number; y: number }>;
  edges: {
    top: { x1: number; y: number; x2: number };
    bottom: { x1: number; y: number; x2: number };
    left: { x: number; y1: number; y2: number };
    right: { x: number; y1: number; y2: number };
  };
  Math: Record<string, any>;
}

export class DecoratorSandboxError extends Error {
  constructor(message: string, public stage: 'parse' | 'validate' | 'execute' | 'output') {
    super(message);
    this.name = 'DecoratorSandboxError';
  }
}

/** AST 白名单验证 */
function validateAST(code: string): void {
  let ast;
  try {
    ast = parse(code, { sourceType: 'script', allowReturnOutsideFunction: false });
  } catch (e) {
    throw new DecoratorSandboxError(
      `parse error: ${e instanceof Error ? e.message : String(e)}`,
      'parse'
    );
  }

  const violations: string[] = [];

  traverse(ast, {
    enter(path) {
      const t = path.node.type;
      if (FORBIDDEN_NODE_TYPES.has(t)) {
        violations.push(`forbidden node type: ${t} at line ${path.node.loc?.start.line ?? '?'}`);
        return;
      }
      if (t === 'Identifier') {
        const name = (path.node as any).name;
        // 允许声明里的 identifier 名（变量名/函数名 random 等），仅检查引用
        if (
          DANGEROUS_IDENTIFIERS.has(name) &&
          !path.isVariableDeclarator() &&
          !path.isFunctionDeclaration() &&
          !(
            path.parent.type === 'MemberExpression' &&
            path.parent.property === path.node &&
            !path.parent.computed
          )
        ) {
          // 检查是否 binding 到全局（顶层 free identifier）
          const binding = path.scope.getBinding(name);
          if (!binding && name !== 'ctx' && name !== 'generate') {
            // 顶层引用 + 在危险清单 → 拒绝
            violations.push(
              `forbidden global identifier: "${name}" at line ${path.node.loc?.start.line ?? '?'}`
            );
          }
        }
      }
      if (t === 'MemberExpression') {
        const prop = (path.node as any).property;
        if (prop && prop.type === 'Identifier' && FORBIDDEN_PROPERTY_NAMES.has(prop.name)) {
          violations.push(`forbidden property: ${prop.name}`);
        }
      }
    },
  });

  if (violations.length > 0) {
    throw new DecoratorSandboxError(
      `AST validation failed:\n${violations.slice(0, 5).join('\n')}`,
      'validate'
    );
  }
}

/** sanitize 单个 SVG path d 值（复用 text-label-generator 中已有的 sanitizePathD 逻辑） */
function sanitizePathD(raw: string): string {
  let s = raw.trim();
  const pathMatch = s.match(/<path[^>]*\bd\s*=\s*["']([^"']+)["']/i);
  if (pathMatch) s = pathMatch[1];
  s = s.replace(/[^a-zA-Z0-9\s,.\-+eE]/g, '');
  return s.trim();
}

export function executeDecorator(code: string, ctx: DecoratorContext): string[] {
  // 第 1 层：AST 白名单
  validateAST(code);

  // 第 2 层：vm.runInNewContext 执行 + timeout
  const wrappedCode = `${code}\n; result = generate(ctx);`;

  const sandboxGlobals: any = {
    ctx,
    result: null,
  };

  const context = vm.createContext(sandboxGlobals, {
    name: 'decorator-sandbox',
    codeGeneration: { strings: false, wasm: false }, // 禁止 new Function(string)
  });

  try {
    vm.runInContext(wrappedCode, context, {
      timeout: 3000,
      displayErrors: true,
      breakOnSigint: true,
    });
  } catch (e) {
    throw new DecoratorSandboxError(
      `execution error: ${e instanceof Error ? e.message : String(e)}`,
      'execute'
    );
  }

  const result = sandboxGlobals.result;

  // 第 3 层：输出验证
  if (!Array.isArray(result)) {
    throw new DecoratorSandboxError(
      `generate() must return string[], got: ${typeof result}`,
      'output'
    );
  }

  // sanitize 每个 path + 截 max 32 个 path 防爆炸
  const cleaned = result
    .filter((p: any) => typeof p === 'string' && p.trim().length > 0)
    .map((p: string) => sanitizePathD(p))
    .filter((p: string) => p.length > 0)
    .slice(0, 32);

  return cleaned;
}

/** 标准 ctx for 320x160 label */
export function buildStandardContext(widthPx: number, heightPx: number): DecoratorContext {
  return {
    width: widthPx,
    height: heightPx,
    safeZone: { x: 24, y: 24, w: widthPx - 48, h: heightPx - 48 },
    corners: [
      { x: 0, y: 0 },
      { x: widthPx, y: 0 },
      { x: 0, y: heightPx },
      { x: widthPx, y: heightPx },
    ],
    edges: {
      top: { x1: 24, y: 0, x2: widthPx - 24 },
      bottom: { x1: 24, y: heightPx, x2: widthPx - 24 },
      left: { x: 0, y1: 24, y2: heightPx - 24 },
      right: { x: widthPx, y1: 24, y2: heightPx - 24 },
    },
    Math: {
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      PI: Math.PI,
      sqrt: Math.sqrt,
      pow: Math.pow,
      abs: Math.abs,
      floor: Math.floor,
      ceil: Math.ceil,
      round: Math.round,
      min: Math.min,
      max: Math.max,
      random: Math.random,
      atan2: Math.atan2,
      E: Math.E,
      LN2: Math.LN2,
      LN10: Math.LN10,
    },
  };
}
