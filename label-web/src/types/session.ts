export type TurnState = 'pending' | 'running' | 'succeeded' | 'failed';
export type TurnKind = 'root' | 'refine' | 'redither' | 'decoration';
export type GenMode = 'template' | 'img2img' | 'rewrite';

export interface SessionTurn {
  id: string;
  parentTurnId: string | null;
  turnKind: TurnKind;
  genMode: GenMode | null;
  userFeedback: string | null;
  /** planner 这轮给用户的确认回复(存在 params.planner.reply,后端已拍平到这里) */
  agentReply: string | null;
  refImageUrls: string[];
  params: Record<string, any> | null;
  effectivePrompt: string | null;
  /** 中文版 prompt(双语:给人看/编辑;英文 effectivePrompt 给模型生图)。后端未返回时为 undefined,前端回退英文 */
  effectivePromptZh?: string | null;
  jobId: string | null;
  state: TurnState;
  lastError: string | null;
  label: {
    id: string;
    pngUrl: string | null;
    status: string;
    sourceImageUrl: string | null;
  } | null;
  createdAt: string;
}

export interface SessionInfo {
  id: string;
  subjectType: 'batch_item' | 'standalone';
  subjectId: string | null;
  currentTurnId: string | null;
  createdAt: string;
}

export interface SessionTree {
  session: SessionInfo;
  turns: SessionTurn[];
  recycledTurns: SessionTurn[];
}

/** planner 给出的候选参考图(带默认勾选);用户可在确认面板里加/减 */
export interface CandidateRef {
  url: string;
  label: string;
  source: 'history' | 'upload' | 'input';
  selected: boolean;
}

/** 一条可选的重生成路径;fresh = 全新起点(baseTurnId=null,不继承任何现有版本) */
export interface PlanPath {
  id: string;
  label: string;
  recommended: boolean;
  strategy: 'clean-restart' | 'incremental' | 'fresh';
  baseTurnId: string | null;
  baseVersionNo: number | null;
  mode: 'img2img' | 'rewrite';
  prompt: string;
  /** 中文版 prompt(给人看/编辑);后端未返回时 undefined,前端回退英文 prompt */
  promptZh?: string;
  rationale: string;
  candidateRefs: CandidateRef[];
}

/** clarify 模式下 agent 动态生成的一个选项 */
export interface ClarifyChoice {
  id: string;
  label: string;
  description: string;
}

/**
 * POST /label-sessions/:id/plan 的返回:
 * - kind='clarify':需求模糊,agent 反问 question + 动态 choices(2-5,数量灵活)
 * - kind='paths':方向明确,agent 给 1-N 条重生成路径
 */
export interface PlanResponse {
  success: boolean;
  kind: 'clarify' | 'paths';
  reply: string;
  reasoning: string | null;
  question?: string;
  choices?: ClarifyChoice[];
  paths?: PlanPath[];
}
