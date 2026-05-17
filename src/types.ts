export interface Message {
  id: string;
  role: 'system' | 'expert' | 'player';
  author: string;
  content: string;
  timestamp: Date;
  npcId?: string;
}

export type Difficulty = 'easy' | 'medium' | 'hard';

// ── NPC 人格（4 个固定原型） ──
export interface NPCPersonality {
  id: string;
  name: string;
  title: string;       // e.g. "教授", "研究员"
  trait: string;       // 人格描述（来自 NPC_PROFILES）
  avatar: number;      // 头像编号 0-3
}

// ── NPC 向玩家提的问题 ──
export interface PlayerQuestion {
  npcId: string;
  question: string;
}

// ── 游戏状态 ──
export interface GameState {
  topic: string;
  field: string;
  suspicion: number;
  rounds: number;
  status: 'idle' | 'starting' | 'playing' | 'gameover';
  messages: Message[];
  difficulty: Difficulty;
  lastJudge?: JudgeResult;
  npcs: NPCPersonality[];
  playerQuestions: PlayerQuestion[];
  judgeHistory: JudgeEntry[];
}

export interface JudgeResult {
  feedback: string;
  surrender: boolean;
  breakdown?: {
    belonging: number;      // 圈内感（0-10）
    consistency: number;    // 身份自洽（0-10）
    presence: number;       // 存在感（0-10）
    bonus: number;          // 加减分项（-8~+5）
  };
}

// ── 复盘记录 ──
export interface JudgeEntry {
  round: number;
  playerMessage: string;
  feedback: string;
  suspicionChange: number;
  breakdown?: { belonging: number; consistency: number; presence: number; bonus: number };
}
