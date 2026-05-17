/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Send, 
  RefreshCw, 
  User, 
  CircleUser, 
  Terminal, 
  AlertCircle,
  Skull,
  Award,
  Key,
  Save,
  ShieldCheck,
  Settings2
} from 'lucide-react';
import { Message, GameState, Difficulty, NPCPersonality, JudgeEntry } from './types';
import { generateGameStart, generateSingleNPCReply, judgeRound, generateGameRecap, generateTopics } from './services/ai';

const INITIAL_STATE: GameState = {
  topic: '',
  field: '',
  suspicion: 0,
  rounds: 0,
  status: 'idle',
  messages: [],
  difficulty: 'medium',
  lastJudge: undefined,
  npcs: [],
  playerQuestions: [],
  judgeHistory: []
};

export default function App() {
  const [state, setState] = useState<GameState>(INITIAL_STATE);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [gameRecap, setGameRecap] = useState<string | null>(null);
  const [isRecapLoading, setIsRecapLoading] = useState(false);
  const [inputSuggestion, setInputSuggestion] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showDifficultySelect, setShowDifficultySelect] = useState(false);
  const [showThemeSelect, setShowThemeSelect] = useState(false);
  const [customTheme, setCustomTheme] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hasSavedGame, setHasSavedGame] = useState(() => !!localStorage.getItem('fakeExpert_save'));
  const [loadingLogs, setLoadingLogs] = useState<string[]>([]);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [scorePopup, setScorePopup] = useState<{ change: number; feedback: string } | null>(null);
  const [llmTopics, setLlmTopics] = useState<{ name: string; icon: string; topics: string[] }[] | null>(null);
  const [isTopicsLoading, setIsTopicsLoading] = useState(false);
  const [gameResult, setGameResult] = useState<'victory' | 'defeat' | null>(null);
  const [recapPage, setRecapPage] = useState(0);

  // ── 复盘辅助函数 ──
  function computeSuspicionTimeline(history: JudgeEntry[]): { round: number; suspicion: number; change: number }[] {
    let current = 15;
    return history.map(h => {
      current = Math.max(0, Math.min(100, current + h.suspicionChange));
      return { round: h.round, suspicion: current, change: h.suspicionChange };
    });
  }

  function computeRecapStats(history: JudgeEntry[]) {
    if (history.length === 0) return null;
    const changes = history.map(h => h.suspicionChange);
    const best = Math.min(...changes);
    const worst = Math.max(...changes);
    const avg = changes.reduce((a, b) => a + b, 0) / changes.length;
    const bestRound = history.find(h => h.suspicionChange === best)!;
    const worstRound = history.find(h => h.suspicionChange === worst)!;
    return { best, worst, avg, bestRound, worstRound, totalRounds: history.length };
  }

  const [showRuleCard, setShowRuleCard] = useState(true);

  // P3: Persist game state to localStorage when playing
  useEffect(() => {
    if (state.status === 'playing' || state.status === 'gameover') {
      localStorage.setItem('fakeExpert_save', JSON.stringify({
        ...state,
        messages: state.messages.map(m => ({ ...m, timestamp: m.timestamp.toISOString() }))
      }));
      setHasSavedGame(true);
    }
  }, [state]);

  // P3: Restore saved game
  const restoreGame = () => {
    try {
      const saved = JSON.parse(localStorage.getItem('fakeExpert_save') || '');
      if (saved?.status === 'playing' || saved?.status === 'gameover') {
        saved.messages = saved.messages.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }));
        setState(saved);
        if (saved.status === 'gameover') setHasSavedGame(false);
        setErrorMsg(null);
      }
    } catch { localStorage.removeItem('fakeExpert_save'); setHasSavedGame(false); }
  };

  const clearSavedGame = () => {
    localStorage.removeItem('fakeExpert_save');
    setHasSavedGame(false);
    setState(INITIAL_STATE);
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [state.messages, isTyping]);

  // P2: Generate recap when game ends
  useEffect(() => {
    if (state.status === 'gameover' && !gameRecap && !isRecapLoading) {
      setIsRecapLoading(true);
      setRecapPage(0);
      generateGameRecap(state.field, state.topic, state.rounds, state.suspicion, state.messages, state.npcs, state.judgeHistory)
        .then(setGameRecap)
        .catch(() => setGameRecap(null))
        .finally(() => setIsRecapLoading(false));
    }
  }, [state.status, gameRecap, isRecapLoading]);

  // Loading screen animation — moved here (must be BEFORE any conditional return)
  useEffect(() => {
    if (state.status !== 'starting') {
      setLoadingLogs([]);
      setLoadingProgress(0);
      return;
    }
    const logs = [
      '> scanning conversation patterns...',
      '> capturing discourse signals...',
      '> constructing identity shell...',
      '> injecting linguistic camouflage...',
      '> anchor established. blending in.',
    ];
    let i = 0;
    setLoadingLogs([]);
    setLoadingProgress(0);
    const timer = setInterval(() => {
      if (i < logs.length) {
        setLoadingLogs(prev => [...prev, logs[i]]);
        setLoadingProgress(Math.round(((i + 1) / logs.length) * 100));
        i++;
      } else {
        clearInterval(timer);
      }
    }, 120);
    return () => clearInterval(timer);
  }, [state.status]);

  const [showApiKeySettings, setShowApiKeySettings] = useState(false);
  const [tempGeminiKey, setTempGeminiKey] = useState(localStorage.getItem('GEMINI_API_KEY') || '');
  const [tempDeepseekKey, setTempDeepseekKey] = useState(localStorage.getItem('DEEPSEEK_API_KEY') || '');

  const saveApiKeys = () => {
    localStorage.setItem('GEMINI_API_KEY', tempGeminiKey);
    localStorage.setItem('DEEPSEEK_API_KEY', tempDeepseekKey);
    setShowApiKeySettings(false);
    setErrorMsg(null);
  };

  const startGame = async (diff: Difficulty = 'medium', theme?: string) => {
    setShowDifficultySelect(false);
    setShowThemeSelect(false);
    setErrorMsg(null);
    setGameRecap(null);
    setIsRecapLoading(false);
    setGameResult(null);
    setRecapPage(0);
    setShowRuleCard(true);
    setLoadingLogs([]);
    setLoadingProgress(0);
    setState(prev => ({ ...prev, status: 'starting', messages: [], suspicion: 0, difficulty: diff, npcs: [], playerQuestions: [] }));
    try {
      const { field, topic, initialExperts, npcs } = await generateGameStart(diff, theme);
      const messages: Message[] = initialExperts.map((exp: any, i: number) => {
        const matchedNpc = npcs.find(n => n.name === exp.author) || npcs[i % npcs.length];
        return {
          id: `init-${i}`,
          role: 'expert' as const,
          author: exp.author,
          content: exp.content,
          timestamp: new Date(),
          npcId: matchedNpc?.id,
        };
      });

      setState({
        topic,
        field,
        suspicion: 15,
        rounds: 1,
        status: 'playing',
        messages,
        difficulty: diff,
        lastJudge: undefined,
        npcs: npcs || [],
        playerQuestions: [],
        judgeHistory: []
      });
    } catch (error) {
      console.error("Failed to start game:", error);
      setErrorMsg("论坛进不去（AI 响应失败）。请在左侧侧边栏通过 [Settings > Secrets] 添加入自己的 API Key (GEMINI_API_KEY 或 DEEPSEEK_API_KEY)。");
      setState(INITIAL_STATE);
    }
  };

  // NPC 头像颜色映射
  const NPC_COLORS = ['bg-blue-600/20 border-blue-500/30 text-blue-400', 'bg-amber-600/20 border-amber-500/30 text-amber-400', 'bg-emerald-600/20 border-emerald-500/30 text-emerald-400', 'bg-rose-600/20 border-rose-500/30 text-rose-400'];
  const getNpcColor = (npcId: string) => NPC_COLORS[parseInt(npcId?.split('_')[1] || '0') % 4] || NPC_COLORS[0];
  const getNpc = (npcId: string) => state.npcs.find(n => n.id === npcId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || state.status !== 'playing' || isTyping) return;

    const text = inputValue;
    setInputValue('');
    setIsTyping(true);

    const playerMsg: Message = {
      id: `p-${Date.now()}`,
      role: 'player',
      author: '你（身份流亡者）',
      content: text,
      timestamp: new Date()
    };

    // Show player message + round increment immediately
    setState(prev => ({ ...prev, messages: [...prev.messages, playerMsg], rounds: prev.rounds + 1 }));

    try {
      const currentRound = state.rounds + 1;
      const fullHistory = [...state.messages, playerMsg];

      // ── 先评测：用上一轮 NPC 的发言来评估玩家本轮回应 ──
      const prevNpcDialogue = state.messages
        .filter((m: any) => m.role === 'expert' && m.npcId)
        .slice(-4)
        .map((m: any) => ({ npcId: m.npcId || '', content: m.content }));

      const playerHistory = fullHistory
        .filter((m: any) => m.role === 'player')
        .slice(-5)
        .map((m: any) => m.content)
        .join('\n---\n');

      const judge = await judgeRound(text, prevNpcDialogue, state.npcs, playerHistory, state.suspicion, currentRound, state.difficulty);

      // ── 从评审分数计算暴露指数增量（难度控制衰减/放大系数）──
      const b = judge.breakdown || { belonging: 5, consistency: 5, presence: 5, bonus: 0 };
      const DIFF_WEIGHT = { easy: 0.3, medium: 0.5, hard: 2.0 }[state.difficulty];
      const avgScore = (b.belonging + b.consistency + b.presence) / 3;
      const suspicionIncrease = judge.surrender ? 50 : Math.round(avgScore * DIFF_WEIGHT + (b.bonus || 0));

      const finalSuspicion = Math.max(0, Math.min(100, state.suspicion + suspicionIncrease));

      // ── 独立游戏结束判定 ──
      const VICTORY = {
        easy:   { requiredRounds: 8  },
        medium: { requiredRounds: 10 },
        hard:   { requiredRounds: 10 },
      }[state.difficulty];

      const isLoss = judge.surrender || finalSuspicion >= 100;
      const isWin = !isLoss && currentRound >= VICTORY.requiredRounds;

      setGameResult(isWin ? 'victory' : isLoss ? 'defeat' : null);

      setState(prev => ({
        ...prev,
        suspicion: finalSuspicion,
        lastJudge: judge,
        playerQuestions: [],
        judgeHistory: [...prev.judgeHistory, {
          round: currentRound,
          playerMessage: text,
          feedback: judge.feedback,
          suspicionChange: suspicionIncrease,
          breakdown: judge.breakdown,
        }],
        status: isLoss || isWin ? 'gameover' : 'playing'
      }));

      // ── 立刻显示评测弹窗 ──
      setScorePopup({ change: suspicionIncrease, feedback: judge.feedback });
      setTimeout(() => setScorePopup(null), 2500);

      // 如果游戏结束，不再生成 NPC 回复
      if (isLoss || isWin) return;

      // ── 再串行输出 NPC 回复 ──
      const dialogue: { npcId: string; content: string }[] = [];
      const shuffled = [...state.npcs].sort(() => Math.random() - 0.5).slice(0, 4);
      for (let i = 0; i < shuffled.length; i++) {
        const npc = shuffled[i];
        const prevContent = i > 0 ? dialogue[i - 1].content : null;

        const content = await generateSingleNPCReply(
          npc, '', currentRound, text, prevContent, fullHistory, state.difficulty
        );

        dialogue.push({ npcId: npc.id, content });

        const npcMsg: Message = {
          id: `npc-${Date.now()}-${i}`,
          role: 'expert' as const,
          author: npc.name,
          content,
          timestamp: new Date(),
          npcId: npc.id,
        };
        setState(prev => ({ ...prev, messages: [...prev.messages, npcMsg] }));

        if (i < shuffled.length - 1) {
          await new Promise(r => setTimeout(r, 500 + Math.random() * 600));
        }
      }

    } catch (error) {
      console.error("Turn failed:", error);
      setInputValue(text);
      setErrorMsg("学术委员会暂时失联（AI 请求错误）。请检查 API Key 额度或稍后重试。");
    } finally {
      setIsTyping(false);
    }
  };

  // 根据输入内容动态建议
  useEffect(() => {
    if (!inputValue || state.status !== 'playing') { setInputSuggestion(''); return; }
    const v = inputValue.trim();
    if (v.length > 10 && !v.includes('可能') && !v.includes('因为')) {
      setInputSuggestion('💡 试试加一句："这可能是因为..."（给出因果解释）');
    } else if (v.includes('因为') && !v.includes('如果') && !v.includes('假设')) {
      setInputSuggestion('💡 接下来试试："如果这个假设成立，那么..."（推导一个推论）');
    } else if (v.includes('如果') && !v.includes('当然') && !v.includes('前提')) {
      setInputSuggestion('💡 收个尾："当然，前提是..."（承认一个边界条件，这会降低暴露指数）');
    } else {
      setInputSuggestion('');
    }
  }, [inputValue, state.status]);

  if (state.status === 'idle') {
    return (
      <div className="min-h-screen text-slate-100 flex items-center justify-center p-4 font-sans relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #0a0a0f 0%, #111122 30%, #0f1729 60%, #0a0a14 100%)' }}>
        {/* Scanline overlay */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.025] z-0"
          style={{ backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,0,0.2) 2px, rgba(0,255,0,0.2) 4px)' }} />
        {/* Animated grid */}
        <div className="absolute inset-0 z-0 opacity-[0.04] pointer-events-none"
          style={{
            backgroundImage: 'linear-gradient(rgba(0,255,200,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,200,0.08) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
            animation: 'homeGridShift 12s linear infinite',
          }} />
        {/* Drifting glow orbs */}
        <motion.div animate={{ x: [0, 40, -30, 0], y: [0, -30, 40, 0] }}
          transition={{ duration: 22, repeat: Infinity, ease: 'linear' }}
          className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-emerald-500/15 rounded-full blur-[180px] pointer-events-none z-0" />
        <motion.div animate={{ x: [0, -40, 30, 0], y: [0, 30, -40, 0] }}
          transition={{ duration: 26, repeat: Infinity, ease: 'linear' }}
          className="absolute bottom-1/3 right-1/4 w-[450px] h-[450px] bg-amber-500/10 rounded-full blur-[160px] pointer-events-none z-0" />
        <motion.div animate={{ x: [0, 30, -40, 0], y: [0, -40, 30, 0] }}
          transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
          className="absolute top-1/2 left-1/3 w-[400px] h-[400px] bg-violet-500/12 rounded-full blur-[150px] pointer-events-none z-0" />
        <motion.div animate={{ x: [0, -30, 40, 0], y: [0, 40, -30, 0] }}
          transition={{ duration: 24, repeat: Infinity, ease: 'linear' }}
          className="absolute bottom-1/4 left-1/2 w-[350px] h-[350px] bg-blue-500/12 rounded-full blur-[140px] pointer-events-none z-0" />
        {/* Floating geometric shapes */}
        <div className="absolute inset-0 pointer-events-none z-0">
          {[
            { t: '12%', l: '6%', s: 24, c: 'rgba(0,255,200,0.07)', r: 45, d: 14 },
            { t: '78%', l: '88%', s: 32, c: 'rgba(168,85,247,0.07)', r: 60, d: 18 },
            { t: '65%', l: '8%', s: 18, c: 'rgba(245,158,11,0.07)', r: 30, d: 12 },
            { t: '18%', l: '85%', s: 26, c: 'rgba(59,130,246,0.07)', r: 90, d: 20 },
            { t: '45%', l: '92%', s: 14, c: 'rgba(236,72,153,0.07)', r: 0, d: 16 },
            { t: '85%', l: '15%', s: 20, c: 'rgba(251,191,36,0.07)', r: 120, d: 13 },
          ].map((sh, i) => (
            <motion.div key={i} animate={{ rotate: [sh.r, sh.r + 360], scale: [1, 1.15, 1] }}
              transition={{ duration: sh.d, repeat: Infinity, ease: 'linear' }}
              style={{ position:'absolute', top:sh.t, left:sh.l, width:sh.s, height:sh.s,
                border:'1px solid ' + sh.c, transform:`rotate(${sh.r}deg)` }}
              className="pointer-events-none" />
          ))}
        </div>
        {/* Enhanced particles */}
        <div className="absolute inset-0 pointer-events-none z-0">
          {[...Array(60)].map((_, i) => (
            <span key={i} style={{
              position: 'absolute', display: 'block',
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              width: 1 + Math.random() * 3,
              height: 1 + Math.random() * 3,
              borderRadius: '50%',
              background: i % 4 === 0 ? 'rgba(168,85,247,0.35)'
                : i % 4 === 1 ? 'rgba(0,255,200,0.3)'
                : i % 4 === 2 ? 'rgba(245,158,11,0.3)'
                : 'rgba(0,200,255,0.25)',
              boxShadow: i % 4 === 0 ? '0 0 4px rgba(168,85,247,0.3)' : 'none',
              animation: `homeFloat ${4 + Math.random() * 10}s ease-in-out infinite`,
              animationDelay: `${Math.random() * 8}s`,
              opacity: 0.15 + Math.random() * 0.35,
            }} />
          ))}
        </div>
        <style>{`
          @keyframes homeFloat { 0%,100% { transform: translateY(0) translateX(0); opacity: 0.15; } 50% { transform: translateY(-40px) translateX(15px); opacity: 0.55; } }
          @keyframes homePulse { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }
          @keyframes homeGridShift { 0% { transform: translate(0,0); } 50% { transform: translate(10px,10px); } 100% { transform: translate(0,0); } }
          @keyframes homeGlowPulse { 0%,100% { box-shadow: 0 0 20px rgba(59,130,246,0.2), 0 0 60px rgba(59,130,246,0.1); } 50% { box-shadow: 0 0 40px rgba(59,130,246,0.4), 0 0 100px rgba(59,130,246,0.2); } }
          @keyframes homeBorderDash { 0% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: -100; } }
          @keyframes homeShimmer { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
        `}</style>

        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-xl w-full space-y-6 relative z-10"
        >
          {/* Title */}
          <div className="text-center space-y-6">
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', delay: 0.1, stiffness: 120 }}
              className="relative inline-block">
              {/* Multi-layer glow rings */}
              <motion.div animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.8, 0.5] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute -inset-8 bg-gradient-to-br from-blue-500/30 via-violet-500/20 to-blue-500/30 blur-3xl rounded-full" />
              <motion.div animate={{ scale: [1, 1.08, 1], opacity: [0.3, 0.6, 0.3] }}
                transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
                className="absolute -inset-12 bg-gradient-to-tr from-emerald-500/20 via-blue-500/20 to-violet-500/20 blur-3xl rounded-full" />
              {/* Terminal icon with animated ring */}
              <div className="relative" style={{ animation: 'homeGlowPulse 3s ease-in-out infinite' }}>
                <Terminal className="w-24 h-24 mx-auto text-blue-400 relative drop-shadow-[0_0_15px_rgba(59,130,246,0.5)]" />
              </div>
            </motion.div>
            {/* FAKE title with gradient text */}
            <motion.h1
              initial={{ backgroundPosition: '200% center' }}
              animate={{ backgroundPosition: ['200% center', '-200% center'] }}
              transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
              className="text-7xl font-black tracking-tight bg-gradient-to-r from-white via-blue-300 via-violet-300 to-white bg-clip-text text-transparent"
              style={{ backgroundSize: '200% auto', fontFamily: 'inherit' }}>
              FAKE
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="text-slate-400 text-2xl font-medium tracking-wide [text-shadow:0_0_20px_rgba(148,163,184,0.15)]">
              身份不是你的。是这一轮的。
            </motion.p>
          </div>

          {/* How to play — bold guide */}
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}
            className="relative bg-white/[0.04] rounded-2xl p-6 backdrop-blur-xl text-left space-y-4 overflow-hidden group"
            style={{ backdropFilter: 'blur(24px)' }}>
            {/* Animated gradient border */}
            <div className="absolute inset-0 rounded-2xl pointer-events-none"
              style={{
                padding: '1px',
                background: 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(168,85,247,0.1), rgba(52,211,153,0.15), rgba(59,130,246,0.15))',
                backgroundSize: '300% 300%',
                WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                WebkitMaskComposite: 'xor',
                maskComposite: 'exclude',
                animation: 'homeShimmer 6s ease-in-out infinite',
              }} />
            {/* Inner glow on hover */}
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-blue-500/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
            <div className="space-y-3 relative z-10" style={{ fontSize: '19px', lineHeight: 2 }}>
              {[
                { emoji: '🎭', text: '每轮你', bold: '构造一个新的自己', suffix: '——身份只有一句话的寿命' },
                { emoji: '💬', text: '用NPC的词汇和节奏说话，让他们以为', bold: '你是自己人', suffix: '' },
                { emoji: '❓', text: '被质疑时不解释，', bold: '只重塑', suffix: '——你没义务保持前后一致' },
                { emoji: '💀', text: '身份崩解 = ', bold: '流亡结束', suffix: '' },
              ].map((line, i) => (
                <motion.p key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 + i * 0.1 }}
                  className="text-slate-300 flex items-center gap-3">
                  <span className="text-3xl shrink-0">{line.emoji}</span>
                  <span>{line.text}<b className="text-white">{line.bold}</b>{line.suffix}</span>
                </motion.p>
              ))}
            </div>
          </motion.div>

          {/* API Settings */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-4 backdrop-blur-sm">
            <button 
              onClick={() => setShowApiKeySettings(!showApiKeySettings)}
              className="w-full flex items-center justify-between text-slate-300 hover:text-white transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-500/10 rounded-lg">
                  <Key className="w-5 h-5 text-indigo-400" />
                </div>
                <div className="text-left">
                  <div className="text-sm font-semibold">API 配置</div>
                   <div className="text-[10px] text-slate-500">接入语言引擎以构建NPC身份</div>
                </div>
              </div>
              <Settings2 className={`w-4 h-4 transition-transform ${showApiKeySettings ? 'rotate-90 text-indigo-400' : 'text-slate-600'}`} />
            </button>
            {showApiKeySettings && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                className="mt-4 pt-4 border-t border-slate-700/50 space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs uppercase tracking-wider text-slate-500 font-bold ml-1">Gemini API Key</label>
                  <input type="password" value={tempGeminiKey} onChange={(e) => setTempGeminiKey(e.target.value)}
                    placeholder="AI Studio API Key..."
                    className="w-full bg-slate-900/50 border border-slate-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-500/50 transition-colors text-slate-300" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs uppercase tracking-wider text-slate-500 font-bold ml-1">DeepSeek API Key</label>
                  <input type="password" value={tempDeepseekKey} onChange={(e) => setTempDeepseekKey(e.target.value)}
                    placeholder="DeepSeek API Key (优先使用)..."
                    className="w-full bg-slate-900/50 border border-slate-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-500/50 transition-colors text-slate-300" />
                </div>
                <button onClick={saveApiKeys}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl py-2 text-sm font-semibold flex items-center justify-center gap-2 transition-all active:scale-95">
                  <Save className="w-4 h-4" />保存配置
                </button>
                <div className="flex items-center gap-1.5 px-1 py-1 bg-slate-900/30 rounded-lg">
                  <ShieldCheck className="w-3 h-3 text-emerald-500" />
                  <span className="text-xs text-slate-600 italic">密钥仅保存在浏览器本地</span>
                </div>
              </motion.div>
            )}
          </div>

          {errorMsg && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />{errorMsg}
            </div>
          )}

          {/* Action buttons */}
          <div className="space-y-4">
            {hasSavedGame && (
              <motion.button onClick={restoreGame}
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                className="w-full py-5 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 text-white rounded-xl font-semibold text-xl transition-all shadow-lg shadow-emerald-900/30 flex items-center justify-center gap-2 group relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
                <RefreshCw className="w-5 h-5 group-hover:rotate-180 transition-transform duration-500" />继续上次的潜伏
              </motion.button>
            )}
            <motion.button onClick={() => { clearSavedGame(); setShowThemeSelect(true); }}
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              className="relative w-full py-5 rounded-xl font-semibold text-xl flex items-center justify-center gap-2 group overflow-hidden"
              style={{
                background: 'linear-gradient(135deg, #2563eb, #7c3aed, #2563eb)',
                backgroundSize: '200% 200%',
                animation: 'homeShimmer 4s ease-in-out infinite',
              }}>
              {/* Shine overlay */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
              <span className="relative z-10 text-white drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]">进入论坛</span>
              <motion.span animate={{ x: [0, 6, 0] }} transition={{ repeat: Infinity, duration: 1.5 }}
                className="relative z-10 text-white/80">→</motion.span>
            </motion.button>
          </div>
        </motion.div>

        {/* Topic & Difficulty Selection (conditional overlay) */}
        {showThemeSelect && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            className="max-w-2xl w-full mx-auto space-y-5">
            {/* Header */}
            <div className="text-center">
              <p className="text-xs text-emerald-400/70 font-mono tracking-[0.2em] mb-1">// SELECT YOUR TOPIC</p>
              <p className="text-white font-bold text-lg">选一个话题，开始装</p>
              <p className="text-xs text-slate-500 mt-1">贴近生活 + 有讨论空间 = 效果最好</p>
            </div>

            {/* LLM category cards — 2x3 grid */}
            {llmTopics ? (
              <div className="grid grid-cols-2 gap-3">
                {llmTopics.map((cat, ci) => (
                  <motion.div key={ci} whileHover={{ scale: 1.02 }} transition={{ type: 'spring', stiffness: 300 }}
                    className="bg-slate-900/60 border border-slate-700/30 rounded-xl p-4 backdrop-blur-sm
                      hover:border-emerald-500/30 hover:shadow-lg hover:shadow-emerald-900/10 transition-all">
                    <p className="text-lg mb-2">{cat.icon} <span className="text-white font-bold text-sm">{cat.name}</span></p>
                    <div className="space-y-1.5">
                      {cat.topics.map((t, ti) => (
                        <motion.button key={ti} whileTap={{ scale: 0.97 }}
                          onClick={() => { setCustomTheme(t);
                          const recent = JSON.parse(localStorage.getItem('fakeExpert_recentTopics') || '[]');
                          localStorage.setItem('fakeExpert_recentTopics', JSON.stringify([t, ...recent.filter((x: string) => x !== t)].slice(0,5)));
                          setShowThemeSelect(false); setShowDifficultySelect(true);
                        }}
                          className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-all ${
                            t === customTheme
                              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 shadow-sm shadow-emerald-500/20'
                              : 'bg-slate-950/50 border-slate-700/20 text-slate-400 hover:border-slate-500/40 hover:text-slate-200 hover:bg-slate-900/80'
                          }`}>
                          {t}
                        </motion.button>
                      ))}
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              /* Loading state */
              <div className="text-center py-8">
                <motion.button onClick={async () => {
                  setIsTopicsLoading(true);
                  try {
                    const cats = await generateTopics();
                    setLlmTopics(cats);
                  } catch {}
                  setIsTopicsLoading(false);
                }} disabled={isTopicsLoading}
                  whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                  className="px-8 py-4 bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 rounded-xl font-bold text-base
                    hover:bg-emerald-600/30 hover:shadow-lg hover:shadow-emerald-900/20 transition-all disabled:opacity-40 font-mono tracking-wider">
                  {isTopicsLoading ? (
                    <span className="flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> GENERATING...</span>
                  ) : '> 加载话题池'}
                </motion.button>
                <p className="text-xs text-slate-600 mt-3 font-mono">// 用 AI 实时生成热门讨论话题</p>
              </div>
            )}

            {/* Divider */}
            <div className="flex items-center gap-3 text-xs text-slate-600">
              <span className="flex-1 h-px bg-slate-700/30" />
              <span className="font-mono">OR</span>
              <span className="flex-1 h-px bg-slate-700/30" />
            </div>

            {/* Custom input */}
            <div className="flex gap-3">
              <input value={customTheme} onChange={e => setCustomTheme(e.target.value)}
                placeholder="自己写一个话题..."
                className="flex-1 bg-slate-950 border border-slate-700/40 rounded-xl px-5 py-4 text-sm font-mono
                  focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/40 transition-all text-slate-300
                  placeholder:text-slate-600" />
              <button onClick={async () => {
                setIsTopicsLoading(true);
                try {
                  const cats = await generateTopics();
                  setLlmTopics(cats);
                  if (cats?.[0]?.topics?.[0]) setCustomTheme(cats[0].topics[Math.floor(Math.random() * cats[0].topics.length)]);
                } catch {}
                setIsTopicsLoading(false);
              }} disabled={isTopicsLoading}
                className="px-5 py-4 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 rounded-xl font-medium
                  transition-all text-sm flex items-center gap-2 border border-slate-700/30 font-mono">
                <RefreshCw className={`w-4 h-4 ${isTopicsLoading ? 'animate-spin' : ''}`}/>
                <span className="hidden sm:inline">{isTopicsLoading ? '生成中' : '随机灵感'}</span>
              </button>
            </div>

            {/* Confirm + Back */}
            <div className="flex gap-3">
              <button onClick={() => { if (customTheme.trim()) {
                const recent = JSON.parse(localStorage.getItem('fakeExpert_recentTopics') || '[]');
                localStorage.setItem('fakeExpert_recentTopics', JSON.stringify([customTheme.trim(), ...recent.filter((x: string) => x !== customTheme.trim())].slice(0,5)));
                setShowThemeSelect(false); setShowDifficultySelect(true);
              }}} disabled={!customTheme.trim()}
                className="flex-1 py-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-xl font-bold
                  transition-all text-base tracking-wide">确认 →</button>
              <button onClick={() => setShowThemeSelect(false)}
                className="px-6 py-4 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-xl font-medium transition-all text-sm">
                ← 返回
              </button>
            </div>
          </motion.div>
        )}

        {showDifficultySelect && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            className="max-w-lg w-full mx-auto space-y-4">
            <div className="text-center">
              <p className="text-xs text-emerald-400/70 font-mono tracking-[0.2em] mb-1">// SELECT DIFFICULTY</p>
              <p className="text-white font-bold text-lg mt-1">评分子度决定生存压力</p>
            </div>
            <div className="grid gap-3">
              {[
                { id:'easy',
                  label:'简单',
                  color:'border-emerald-500/20 hover:border-emerald-500/40',
                  bg:'bg-emerald-500/5',
                  text:'text-emerald-400',
                  weightText:'text-emerald-400/70',
                  weight:'×0.3 衰减',
                  target:'8 轮',
                  vibe:'失误也没关系，适合熟悉规则' },
                { id:'medium',
                  label:'中等',
                  color:'border-blue-500/20 hover:border-blue-500/40',
                  bg:'bg-blue-500/5',
                  text:'text-blue-400',
                  weightText:'text-blue-400/70',
                  weight:'×0.5 平衡',
                  target:'10 轮',
                  vibe:'正常发挥即可幸存，需抓NPC破绽' },
                { id:'hard',
                  label:'困难',
                  color:'border-red-500/20 hover:border-red-500/40',
                  bg:'bg-red-500/5',
                  text:'text-red-400',
                  weightText:'text-red-400/70',
                  weight:'×2.0 剧烈放大',
                  target:'10 轮',
                  vibe:'一回失误就要命，只有零分才能活' },
              ].map(l => (
                <motion.button key={l.id} onClick={() => startGame(l.id as Difficulty, customTheme)}
                  whileHover={{ scale: 1.02, x: 4 }} whileTap={{ scale: 0.98 }}
                  className={`flex items-center gap-5 p-5 bg-slate-900/50 border rounded-2xl transition-all ${l.color} ${l.bg} text-left group`}>
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${l.color} ${l.bg} group-hover:shadow-lg transition-shadow`}>
                    <span className={`font-black text-base ${l.text}`}>{l.label}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={`text-sm font-bold ${l.text} group-hover:drop-shadow-[0_0_6px_currentColor] transition-all`}>{l.target}存活</span>
                      <span className={`text-[10px] font-mono font-bold ${l.weightText}`}>{l.weight}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{l.vibe}</p>
                  </div>
                </motion.button>
              ))}
            </div>
            <button onClick={() => { setShowDifficultySelect(false); setShowThemeSelect(true); }}
              className="text-slate-500 text-xs hover:text-slate-300 transition-colors w-full text-center py-2">← 回退选择话题</button>
          </motion.div>
        )}

    </div>
  );
  }

  // ───────────────────────────────────
  // LOADING SCREEN
  // ───────────────────────────────────
  if (state.status === 'starting') {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#0a0a0a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '"Courier New", monospace',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Scanlines */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,0,0.04) 2px, rgba(0,255,0,0.04) 4px)',
          zIndex: 0,
        }} />
        {/* Particles — floating green dots */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
          {[...Array(50)].map((_, i) => (
            <span key={i} style={{
              position: 'absolute',
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              width: 2 + Math.random() * 3,
              height: 2 + Math.random() * 3,
              borderRadius: '50%',
              background: Math.random() > 0.5 ? 'rgba(0,255,65,0.6)' : 'rgba(0,200,255,0.4)',
              boxShadow: '0 0 4px currentColor',
              animation: `fakeDrift ${4 + Math.random() * 8}s ease-in-out infinite`,
              animationDelay: `${Math.random() * 5}s`,
              opacity: 0.3 + Math.random() * 0.5,
            }} />
          ))}
        </div>
        {/* Floating binary digits */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
          {[...Array(20)].map((_, i) => (
            <span key={i+50} style={{
              position: 'absolute',
              left: `${5 + Math.random() * 90}%`,
              top: `${Math.random() * 100}%`,
              fontSize: 9 + Math.random() * 4,
              color: Math.random() > 0.6 ? 'rgba(0,255,65,0.15)' : 'rgba(0,200,255,0.1)',
              fontFamily: 'monospace',
              animation: `fakeFloat ${6 + Math.random() * 10}s linear infinite`,
              animationDelay: `${Math.random() * 6}s`,
              pointerEvents: 'none',
            }}>
              {Math.random() > 0.5 ? '1' : '0'}
            </span>
          ))}
        </div>
        {/* Vignette */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.7) 100%)',
          zIndex: 0,
        }} />
        {/* Glow orbs */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 600, height: 600, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,255,65,0.12) 0%, rgba(139,92,246,0.06) 50%, transparent 70%)',
          pointerEvents: 'none', zIndex: 0,
          animation: 'fakePulse 3s ease-in-out infinite',
        }} />
        <div style={{
          position: 'absolute', top: '40%', left: '60%',
          width: 400, height: 400, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(245,158,11,0.06) 0%, transparent 60%)',
          pointerEvents: 'none', zIndex: 0,
        }} />

        <div style={{ position: 'relative', zIndex: 1, maxWidth: 640, width: '100%', padding: 32 }}>
          {/* ASCII header */}
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <pre style={{
              color: 'rgba(0,255,65,0.7)',
              fontSize: 17, lineHeight: 1.2,
              textShadow: '0 0 12px rgba(0,255,0,0.4)',
              fontWeight: 'bold',
            }}>
{`███████╗   █████╗   ██╗  ██╗   ███████╗
██╔════╝  ██╔══██╗  ██║ ██╔╝   ██╔════╝
█████╗    ███████║  █████╔╝    █████╗  
██╔══╝    ██╔══██║  ██╔═██╗    ██╔══╝  
██║       ██║  ██║  ██║  ██╗   ███████╗
╚═╝       ╚═╝  ╚═╝  ╚═╝  ╚═╝   ╚══════╝`}
            </pre>
            <p style={{
              color: 'rgba(0,255,65,0.5)',
              fontSize: 14, letterSpacing: '0.3em',
              animation: 'fakePulse 1.5s ease-in-out infinite',
            }}>
              INITIALIZING INFILTRATION PROTOCOL
            </p>
          </div>

          {/* Terminal */}
          <div style={{
            background: 'rgba(0,0,0,0.8)',
            border: '1px solid rgba(0,255,65,0.15)',
            borderRadius: 8,
            padding: 16,
            minHeight: 180,
            maxHeight: 200,
            overflow: 'hidden',
            marginBottom: 16,
          }}>
            {loadingLogs.map((log, i) => (
              <p key={i} style={{
                margin: 0, padding: 0,
                fontSize: 12,
                color: 'rgba(0,255,65,0.65)',
                lineHeight: 1.7,
                textShadow: '0 0 4px rgba(0,255,0,0.2)',
                opacity: Math.min(1, (i + 1) / 3),
              }}>
                <span style={{ color: 'rgba(0,255,65,0.3)', marginRight: 8 }}>
                  [{new Date().getHours().toString().padStart(2,'0')}:{new Date().getMinutes().toString().padStart(2,'0')}:{(new Date().getSeconds()+i).toString().padStart(2,'0')}]
                </span>
                {log}
              </p>
            ))}
            <span style={{
              display: 'inline-block',
              width: 8, height: 16,
              background: 'rgba(0,255,65,0.6)',
              animation: 'fakeBlink 0.8s step-end infinite',
              verticalAlign: 'middle',
              marginLeft: 4,
            }} />
          </div>

          {/* Progress */}
          <div style={{ marginBottom: 16 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: 10, color: 'rgba(0,255,65,0.4)',
              marginBottom: 6,
            }}>
              <span>PROGRESS</span>
              <span>{loadingProgress}%</span>
            </div>
            <div style={{
              height: 4,
              background: 'rgba(0,255,65,0.08)',
              borderRadius: 2,
              overflow: 'hidden',
              border: '1px solid rgba(0,255,65,0.1)',
            }}>
              <div style={{
                height: '100%',
                width: `${loadingProgress}%`,
                background: 'rgba(0,255,65,0.5)',
                borderRadius: 2,
                transition: 'width 0.3s ease',
                boxShadow: '0 0 10px rgba(0,255,0,0.3)',
              }} />
            </div>
          </div>

          {/* Footer */}
          <p style={{
            textAlign: 'center',
            color: 'rgba(0,255,65,0.25)',
            fontSize: 10,
            letterSpacing: '0.15em',
            animation: 'fakePulse 2s ease-in-out infinite',
          }}>
            DO NOT CLOSE THIS TERMINAL
          </p>
        </div>

        {/* Keyframes injection */}
        <style>{`
          @keyframes fakePulse { 0%,100% { opacity: 0.3; } 50% { opacity: 0.8; } }
          @keyframes fakeBlink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
          @keyframes fakeDrift { 0%,100% { transform: translate(0,0); } 25% { transform: translate(10px,-15px); } 50% { transform: translate(-5px,10px); } 75% { transform: translate(15px,5px); } }
          @keyframes fakeFloat { 0% { transform: translateY(0) rotate(0deg); opacity: 0; } 10% { opacity: 0.6; } 90% { opacity: 0.6; } 100% { transform: translateY(-120px) rotate(90deg); opacity: 0; } }
        `}</style>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen text-slate-200 bg-slate-950">
      {/* Suspicion-driven edge glow — never change background, only edges */}
      <div className="fixed inset-0 pointer-events-none z-0" style={{
        boxShadow: state.suspicion >= 95
          ? 'inset 0 0 350px 100px rgba(217,70,239,0.45), inset 0 0 80px 30px rgba(217,70,239,0.25)'
          : state.suspicion >= 85
          ? 'inset 0 0 250px 70px rgba(217,70,239,0.35), inset 0 0 50px 15px rgba(244,114,182,0.15)'
          : state.suspicion >= 65
          ? 'inset 0 0 150px 40px rgba(244,114,182,0.15)'
          : state.suspicion >= 40
          ? 'inset 0 0 80px 20px rgba(251,207,232,0.06)'
          : 'none'
      }} />

      {/* Edge pulsing wave at extreme suspicion */}
      {state.suspicion >= 90 && (
        <div className="fixed inset-0 pointer-events-none z-0 animate-pulse" style={{
          boxShadow: 'inset 0 0 400px 120px rgba(217,70,239,0.2), inset 0 0 100px 40px rgba(217,70,239,0.1)',
          transition: 'opacity 0.5s',
        }} />
      )}

      {/* Screen shake at extreme suspicion */}
      <style>{`
        @keyframes shake { 0%,100% { transform: translate(0,0); } 10% { transform: translate(-2px,1px); } 20% { transform: translate(2px,-1px); } 30% { transform: translate(-1px,2px); } 40% { transform: translate(1px,-2px); } 50% { transform: translate(-2px,1px); } 60% { transform: translate(0,0); } }
        .suspicion-shake { animation: shake 0.6s ease-in-out infinite; }
      `}</style>

      {/* Header */}
      <header className={`border-b sticky top-0 z-10 backdrop-blur-md px-6 py-4 flex items-center justify-between transition-all duration-500 ${state.suspicion >= 85 ? 'suspicion-shake' : ''} ${
        state.suspicion >= 85 ? 'border-fuchsia-500/50 bg-slate-950/90' :
        state.suspicion >= 65 ? 'border-rose-500/25 bg-slate-950/90' :
        state.suspicion >= 40 ? 'border-rose-400/20 bg-slate-950/90' :
        'border-white/5 bg-slate-900/50'
      }`}>
        <div className="flex items-center gap-4">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center border transition-all duration-500 ${
            state.suspicion >= 85 ? 'bg-fuchsia-600/30 border-fuchsia-500/40' :
            state.suspicion >= 65 ? 'bg-rose-600/15 border-rose-500/20' :
            state.suspicion >= 40 ? 'bg-rose-600/15 border-rose-400/20' :
            'bg-blue-600/20 border-blue-500/30'
          }`}>
            <Terminal className={`w-5 h-5 transition-all duration-500 ${
              state.suspicion >= 65 ? 'text-rose-400' : state.suspicion >= 40 ? 'text-rose-400' : 'text-blue-400'
            }`} />
          </div>
          <div>
            <h2 className="font-bold text-white leading-tight">{state.field}</h2>
            <p className="text-xs text-slate-500 font-mono">讨论主题: {state.topic}</p>
          </div>
        </div>

          <div className="flex items-center gap-6">
            <div className="flex flex-col items-center">
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-none mb-1">回合</p>
              <div className="text-white font-bold text-2xl font-mono tracking-wider">
                第{state.rounds}回合
              </div>
            </div>

          <div className="block">
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">面具完整度</p>
            <div className={`w-24 sm:w-48 h-2 rounded-full overflow-hidden border transition-all duration-500 ${
              state.suspicion >= 85 ? 'border-red-500/40 shadow-[0_0_12px_rgba(239,68,68,0.3)]' :
              state.suspicion >= 65 ? 'border-red-500/20' :
              state.suspicion >= 40 ? 'border-amber-500/15' :
              'border-white/5'
            } bg-slate-800`}>
              <motion.div 
                className={`h-full transition-colors duration-500 ${
                  state.suspicion >= 85 ? 'bg-fuchsia-500 shadow-[0_0_8px_rgba(217,70,239,0.6)]' :
                  state.suspicion >= 65 ? 'bg-rose-500' :
                  state.suspicion >= 40 ? 'bg-rose-400' :
                  'bg-emerald-500'
                }`}
                initial={{ width: 0 }}
                animate={{ width: `${100 - state.suspicion}%` }}
              />
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-none mb-1">暴露指数</p>
            <span className={`text-xl font-mono font-bold transition-all duration-500 ${
              state.suspicion >= 85 ? 'text-fuchsia-300 animate-pulse text-2xl' :
              state.suspicion >= 65 ? 'text-rose-300' :
              state.suspicion >= 40 ? 'text-rose-300' :
              'text-emerald-300'
            }`} style={{ textShadow: state.suspicion >= 85 ? '0 0 30px rgba(217,70,239,0.7), 0 0 15px rgba(217,70,239,0.4)' : '0 0 8px rgba(0,0,0,0.8)' }}>
              {state.suspicion}%
            </span>
            {state.suspicion >= 85 && (
              <p className="text-[10px] text-fuchsia-400 font-bold uppercase tracking-widest animate-pulse mt-0.5">即将崩解</p>
            )}
          </div>

          {/* Escape & Restart */}
          <div className="flex items-center gap-3 ml-6">
            <button onClick={() => { setState(INITIAL_STATE); setGameResult(null); setRecapPage(0); localStorage.removeItem('fakeExpert_save'); setHasSavedGame(false); setLlmTopics(null); }}
              className="flex flex-col items-center gap-1 px-4 py-2.5 bg-slate-900/90 border border-rose-500/25 rounded-xl
                hover:bg-rose-500/15 hover:border-rose-500/50 transition-all text-rose-400/60 hover:text-rose-400 group"
              title="流亡中断 → 回到首页">
              <span className="font-mono text-sm font-bold tracking-wider group-hover:animate-pulse">[ESC]</span>
              <span className="text-[10px] text-slate-500 group-hover:text-rose-400/60">流亡中断</span>
            </button>
            <button onClick={() => { setState(INITIAL_STATE); setGameResult(null); setRecapPage(0); setShowDifficultySelect(false); setShowThemeSelect(true); setLlmTopics(null); }}
              className="flex flex-col items-center gap-1 px-4 py-2.5 bg-slate-900/90 border border-blue-500/25 rounded-xl
                hover:bg-blue-500/15 hover:border-blue-500/50 transition-all text-blue-400/60 hover:text-blue-400 group"
              title="重塑身份 → 回到话题选择">
              <span className="font-mono text-sm font-bold tracking-wider group-hover:animate-pulse">[RST]</span>
              <span className="text-[10px] text-slate-500 group-hover:text-blue-400/60">重塑身份</span>
            </button>
          </div>
        </div>
      </header>

      {/* Identity stability bar — violet→gold gradient, fractures at high suspicion */}
      <div className="relative h-[2px] z-10">
        <div className={`absolute inset-0 bg-gradient-to-r from-violet-500/80 via-violet-400/50 to-amber-400/70 transition-all duration-500 ${
          state.suspicion >= 85 ? 'opacity-40 [mask-image:repeating-linear-gradient(90deg,transparent,transparent_3px,black_3px,black_6px)]' :
          state.suspicion >= 65 ? 'opacity-60' :
          'opacity-80'
        }`} />
        {state.suspicion >= 85 && (
          <div className="absolute inset-0 bg-gradient-to-r from-fuchsia-500/60 via-transparent to-transparent animate-pulse" />
        )}
      </div>

      {/* Suspicion Breakdown Panel */}
      <AnimatePresence>
        {state.lastJudge && state.status === 'playing' && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-slate-900/80 border-b border-white/5 overflow-hidden"
          >
            <div className="max-w-4xl mx-auto px-6 py-3 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">身份审判</span>
                  <span className="text-xs text-slate-300 italic">“{state.lastJudge.feedback}”</span>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="flex flex-col items-center">
                  <span className="text-[9px] text-slate-500 uppercase font-bold">圈内感</span>
                  <span className={`text-xs font-mono font-bold ${state.lastJudge.breakdown?.belonging && state.lastJudge.breakdown.belonging < 0 ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {state.lastJudge.breakdown?.belonging && state.lastJudge.breakdown.belonging > 0 ? '+' : ''}{state.lastJudge.breakdown?.belonging ?? 0}
                  </span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-[9px] text-slate-500 uppercase font-bold">身份自洽</span>
                  <span className={`text-xs font-mono font-bold ${state.lastJudge.breakdown?.consistency && state.lastJudge.breakdown.consistency < 0 ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {state.lastJudge.breakdown?.consistency && state.lastJudge.breakdown.consistency > 0 ? '+' : ''}{state.lastJudge.breakdown?.consistency ?? 0}
                  </span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-[9px] text-slate-500 uppercase font-bold">存在感</span>
                  <span className={`text-xs font-mono font-bold ${state.lastJudge.breakdown?.presence && state.lastJudge.breakdown.presence < 0 ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {state.lastJudge.breakdown?.presence && state.lastJudge.breakdown.presence > 0 ? '+' : ''}{state.lastJudge.breakdown?.presence ?? 0}
                  </span>
                </div>
                <div className="h-8 w-[1px] bg-white/10 hidden sm:block" />
                <div className="flex flex-col items-end">
                  <span className="text-[9px] text-slate-500 uppercase font-bold">总评变动</span>
                  <span className={`text-sm font-mono font-bold ${state.lastJudge.suspicionIncrease < 0 ? 'text-emerald-400' : state.lastJudge.suspicionIncrease > 0 ? 'text-red-400' : 'text-slate-400'}`}>
                    {state.lastJudge.suspicionIncrease > 0 ? '+' : ''}{state.lastJudge.suspicionIncrease}%
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Forum View */}
      <div id="forum-messages" ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-8 space-y-6 scroll-smooth">
        <AnimatePresence mode="popLayout">
          {/* Rule Card — first-time game rules */}
          {showRuleCard && state.status === 'playing' && (
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
              className="bg-slate-900/95 border border-emerald-500/20 rounded-2xl p-6 space-y-3 relative overflow-hidden shadow-2xl"
              style={{ backdropFilter: 'blur(12px)' }}>
              {/* Top stripe */}
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-emerald-500/60 via-emerald-400/20 to-transparent" />
              {/* Close button */}
              <button onClick={() => setShowRuleCard(false)}
                className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full bg-slate-800/80 border border-slate-700/30
                  text-slate-500 hover:text-white hover:border-slate-500/50 transition-colors text-sm font-bold">×</button>
              {/* Header */}
              <div className="flex items-center gap-3">
                <span className="text-2xl">🎮</span>
                <div>
                  <p className="text-emerald-400 font-bold text-lg font-mono tracking-wide">// GAME RULES</p>
                  <p className="text-slate-500 text-xs font-mono">你知道越少，装得越像</p>
                </div>
              </div>
              {/* 6 rules */}
              <div className="space-y-2.5 text-base leading-relaxed">
                {[
                  { emoji: '①', text: '你的身份是', bold: '语言造出来的', tail: '——不是事实、不是知识' },
                  { emoji: '②', text: '被质疑时', bold: '别解释。重新构造一个说法', tail: '' },
                  { emoji: '③', text: '三个信号决定你的存亡：', bold: '像不像自己人、话语冲不冲突、有没有存在感', tail: '' },
                  { emoji: '④', text: '说"不知道"或"我输了" = ', bold: '面具坠地，当场死亡', tail: '' },
                  { emoji: '⑤', text: '撑过足够轮次不崩解 = ', bold: '流亡成功', tail: '' },
                  { emoji: '⑥', text: '编故事、偷词汇、岔话题、反问——', bold: '都是合法生存手段', tail: '' },
                ].map((r, i) => (
                  <div key={i} className="flex gap-3">
                    <span className="text-emerald-500/60 font-mono text-sm mt-0.5 shrink-0">{r.emoji}</span>
                    <p className="text-slate-300">
                      {r.text}<span className="text-white font-bold">{r.bold}</span>{r.tail}
                    </p>
                  </div>
                ))}
              </div>
              {/* Footer */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-700/30">
                <span className="text-[10px] text-slate-600 font-mono">不同难度对应不同轮次存活目标</span>
                <button onClick={() => setShowRuleCard(false)}
                  className="px-4 py-1.5 bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 rounded-lg text-sm font-bold
                    hover:bg-emerald-600/30 transition-all font-mono tracking-wider">
                  明白了 →
                </button>
              </div>
            </motion.div>
          )}

          {state.messages.map((msg, idx) => (
            <motion.div
              layout
              initial={{ opacity: 0, x: msg.role === 'player' ? 20 : -20, y: 10 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              key={msg.id}
              className={`flex gap-4 max-w-3xl ${msg.role === 'player' ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}
            >
              <div className={`flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center border text-base font-bold ${
                msg.role === 'player' ? 'bg-blue-600/20 border-blue-500/30 text-blue-400' :
                msg.npcId ? getNpcColor(msg.npcId) :
                'bg-slate-800 border-white/5 text-slate-400'
              }`}>
                {msg.role === 'player' ? <User className="w-5 h-5" /> :
                 msg.npcId ? (getNpc(msg.npcId)?.name?.[0] || '?') :
                 <CircleUser className="w-5 h-5" />}
              </div>
              
              <div className={`space-y-1 ${msg.role === 'player' ? 'text-right' : 'text-left'}`}>
                <div className={`flex items-center gap-2 mb-1 ${msg.role === 'player' ? 'justify-end flex-row-reverse' : ''}`}>
                  <span className="font-bold text-base text-slate-200">{msg.author}</span>
                  <span className="text-[11px] text-slate-500 font-mono">
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className={`p-4 rounded-2xl text-base leading-relaxed ${
                  msg.role === 'player' 
                    ? 'bg-blue-600 text-white rounded-tr-none' 
                    : 'bg-slate-900 border border-white/5 text-slate-100 rounded-tl-none'
                }`}>
                  {msg.content}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {isTyping && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-4">
            <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center animate-pulse">
              <CircleUser className="w-5 h-5 text-slate-600" />
            </div>
            <div className="px-4 py-3 bg-slate-900 border border-white/5 rounded-2xl rounded-tl-none flex gap-1">
              <span className="w-1.5 h-1.5 bg-slate-600 rounded-full animate-bounce" />
              <span className="w-1.5 h-1.5 bg-slate-600 rounded-full animate-bounce delay-75" />
              <span className="w-1.5 h-1.5 bg-slate-600 rounded-full animate-bounce delay-150" />
            </div>
          </motion.div>
        )}
      </div>

      {/* Player Questions */}
      <AnimatePresence>
        {state.playerQuestions && state.playerQuestions.length > 0 && state.status === 'playing' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="px-6 py-3 bg-amber-500/10 border-y border-amber-500/20">
            <p className="text-xs text-amber-400 uppercase tracking-wider font-bold mb-2">专家们向你提问 / They are asking you:</p>
            <div className="flex flex-wrap gap-3">
              {state.playerQuestions.map((q, i) => {
                const npc = getNpc(q.npcId);
                return (
                  <div key={i} className={`flex items-start gap-2 px-3 py-2 rounded-xl border ${getNpcColor(q.npcId)} bg-opacity-10`}>
                    <span className="font-bold text-sm shrink-0">{npc?.name || q.npcId}:</span>
                    <span className="text-sm text-slate-300">"{q.question}"</span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input Area */}
      <footer className="p-4 bg-slate-900/80 backdrop-blur-md border-t border-white/5">
        {state.status === 'gameover' ? (
          gameResult === 'defeat' ? (
            /* ── 失败画面 ── */
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, x: [0, -3, 3, -3, 3, 0] }}
              transition={{ x: { duration: 0.5 } }}
              className="max-w-4xl mx-auto p-8 rounded-2xl bg-red-500/10 border border-red-500/20 text-center space-y-6">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-red-600/20 rounded-full">
                {state.suspicion >= 100 ? <Skull className="w-10 h-10 text-red-500" /> : <span className="text-3xl">😅</span>}
              </div>
              <div className="space-y-2">
                <h3 className="text-3xl font-bold text-white">
                  {state.lastJudge?.surrender ? '你选择了自我暴露。' : state.suspicion >= 100 ? '身份已暴露！' : '你放弃了……吗？'}
                </h3>
                <p className="text-slate-400">
                  {state.lastJudge?.surrender
                    ? `在第 ${state.rounds} 轮主动认输。身份崩解不是被识破的，是亲手撕碎的。`
                    : state.suspicion >= 100
                      ? `你在 ${state.field} 论坛中坚持了 ${state.rounds} 轮就露出了马脚。`
                      : `撑了 ${state.rounds} 轮，在暴露指数 ${state.suspicion}% 的时候破了功。`}
                </p>
              </div>
              {isRecapLoading && !gameRecap && (
                <div className="flex items-center justify-center gap-2 text-slate-500 text-sm">
                  <RefreshCw className="w-4 h-4 animate-spin" />正在复盘...
                </div>
              )}
              {gameRecap && (() => {
                const isDefeat = true;
                const timeline = computeSuspicionTimeline(state.judgeHistory);
                const stats = computeRecapStats(state.judgeHistory);

                // Parse sections by emoji for styled rendering
                const sections: { emoji: string; title: string; lines: string[] }[] = [];
                const rawLines = gameRecap.split('\n').filter(l => l.trim());
                // Pre-process: merge emoji-only lines with following content
                const mergedLines: string[] = [];
                for (let i = 0; i < rawLines.length; i++) {
                  const trimmed = rawLines[i].trim();
                  if (/^[\u{2600}-\u{27BF}\u{1F000}-\u{1FFFF}]/u.test(trimmed) && trimmed.length <= 3 && i + 1 < rawLines.length) {
                    mergedLines.push(trimmed + ' ' + rawLines[i + 1].trim());
                    i++;
                  } else {
                    mergedLines.push(rawLines[i]);
                  }
                }
                let cur: typeof sections[0] | null = null;
                for (const line of mergedLines) {
                  const m = line.match(/^([\u{2600}-\u{27BF}\u{1F000}-\u{1FFFF}])\s*(.+)/u);
                  if (m) { if (cur) sections.push(cur); cur = { emoji: m[1], title: m[2], lines: [] }; }
                  else if (cur) cur.lines.push(line);
                }
                if (cur) sections.push(cur);

                const suspicionColor = (v: number) => v >= 85 ? 'text-fuchsia-400' : v >= 65 ? 'text-rose-400' : v >= 40 ? 'text-amber-400' : 'text-emerald-400';
                const badgeText = isDefeat ? 'CLASSIFIED' : 'DECLASSIFIED';

                return (
                  <div className="bg-slate-900/95 border border-slate-600/30 rounded-2xl p-6 text-left relative overflow-hidden shadow-2xl space-y-5"
                    style={{ backdropFilter: 'blur(8px)' }}>
                    <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent ${isDefeat ? 'via-amber-500/40' : 'via-emerald-500/40'} to-transparent`} />
                    <div className={`absolute top-4 right-4 text-[10px] font-bold ${isDefeat ? 'text-rose-500/40 border-rose-500/30' : 'text-emerald-500/40 border-emerald-500/30'} px-2 py-0.5 rounded rotate-12`}>{badgeText}</div>

                    {/* 三页标签 */}
                    <div className="flex gap-1 bg-slate-800/60 rounded-xl p-1">
                      {[
                        { id: 0, label: '📊', text: '数据' },
                        { id: 1, label: '🤖', text: 'AI复盘' },
                        { id: 2, label: '📜', text: '逐轮日志' },
                      ].map(tab => (
                        <button key={tab.id} onClick={() => setRecapPage(tab.id)}
                          className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                            recapPage === tab.id 
                              ? 'bg-slate-700 text-white shadow-lg' 
                              : 'text-slate-500 hover:text-slate-300'
                          }`}>
                          {tab.label} {tab.text}
                        </button>
                      ))}
                    </div>

                    {/* Page 0: 数据仪表盘 */}
                    {recapPage === 0 && (
                      <div className="space-y-5">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          {[
                            { label: '存活轮次', value: `${state.rounds}`, color: 'text-blue-400' },
                            { label: '最终暴露', value: `${state.suspicion}%`, color: suspicionColor(state.suspicion) },
                            { label: '最佳一轮', value: stats ? `${stats.best}%` : '-', sub: stats?.bestRound.feedback, color: 'text-emerald-400' },
                            { label: '最差一轮', value: stats ? `${stats.worst > 0 ? '+' : ''}${stats.worst}%` : '-', sub: stats?.worstRound.feedback, color: 'text-red-400' },
                          ].map(card => (
                            <div key={card.label} className="bg-slate-800/60 border border-slate-700/30 rounded-xl p-4 text-center">
                              <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">{card.label}</p>
                              <p className={`text-2xl font-black mt-1 ${card.color}`}>{card.value}</p>
                              {card.sub && <p className="text-[10px] text-slate-500 mt-1 line-clamp-1">{card.sub}</p>}
                            </div>
                          ))}
                        </div>

                        {/* 暴露指数趋势图 */}
                        <div className="bg-slate-800/60 border border-slate-700/30 rounded-xl p-5">
                          <p className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-4">暴露指数趋势</p>
                          <div className="relative h-32">
                            <svg className="w-full h-full" viewBox="0 0 240 120" preserveAspectRatio="none">
                              <rect x="0" y="20" width="240" height="28" fill="rgba(52,211,153,0.08)" rx="2" />
                              <rect x="0" y="48" width="240" height="17.5" fill="rgba(251,191,36,0.08)" rx="2" />
                              <rect x="0" y="65.5" width="240" height="14" fill="rgba(244,63,94,0.08)" rx="2" />
                              <rect x="0" y="79.5" width="240" height="24.5" fill="rgba(217,70,239,0.08)" rx="2" />
                              {timeline.length > 1 && (
                                <polyline fill="none" stroke="rgba(148,163,184,0.8)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
                                  points={timeline.map((t, i) => `${i * (240 / (timeline.length - 1))},${120 - (t.suspicion / 100) * 100}`).join(' ')} />
                              )}
                              {timeline.map((t, i) => (
                                <circle key={i} cx={timeline.length > 1 ? i * (240 / (timeline.length - 1)) : 120}
                                  cy={120 - (t.suspicion / 100) * 100} r="4"
                                  fill={t.suspicion >= 85 ? '#d946ef' : t.suspicion >= 65 ? '#f43f5e' : t.suspicion >= 40 ? '#fbbf24' : '#34d399'}
                                  stroke="rgba(0,0,0,0.5)" strokeWidth="1.5" />
                              ))}
                            </svg>
                            <div className="flex justify-between mt-1 text-[10px] text-slate-600 font-mono">
                              {timeline.filter((_, i) => i === 0 || i === timeline.length - 1 || i === Math.floor(timeline.length / 2)).map(t => (
                                <span key={t.round}>R{t.round}</span>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* 三维评分平均值 */}
                        <div className="bg-slate-800/60 border border-slate-700/30 rounded-xl p-5">
                          <p className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-4">三维评分走势</p>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            {(['belonging', 'consistency', 'presence'] as const).map(dim => {
                              const values = state.judgeHistory.map(h => h.breakdown?.[dim] ?? 5);
                              const avg = values.reduce((a, b) => a + b, 0) / values.length;
                              const dimLabels: Record<string, string> = { belonging: '圈内感', consistency: '身份自洽', presence: '存在感' };
                              const dimColors: Record<string, string> = { belonging: 'text-blue-400', consistency: 'text-amber-400', presence: 'text-emerald-400' };
                              return (
                                <div key={dim} className="text-center">
                                  <p className={`text-[10px] uppercase font-bold tracking-wider ${dimColors[dim]}`}>{dimLabels[dim]}</p>
                                  <p className="text-2xl font-black text-white mt-1">{avg.toFixed(1)}</p>
                                  <p className="text-[10px] text-slate-500">平均分</p>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Page 1: AI 深度复盘 */}
                    {recapPage === 1 && (
                      <div className="space-y-5">
                        {sections.filter(s => s.emoji !== '🎭').map((sec, i) => (
                          <div key={i} className="border-t border-slate-800 first:border-t-0 pt-4 first:pt-0">
                            <div className="flex items-center gap-2 mb-3">
                              <span className="text-lg">{sec.emoji}</span>
                              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{sec.title}</span>
                            </div>
                            {sec.emoji === '⚠️' && sec.lines.map((l, j) =>
                              j === 0
                                ? <p key={j} className="text-3xl font-black text-red-400 leading-tight" style={{textShadow:'0 0 30px rgba(239,68,68,0.4)'}}>{l}</p>
                                : <p key={j} className="text-base text-slate-200 leading-relaxed">{l}</p>
                            )}
                            {sec.emoji === '🤖' && <div className="bg-black/80 border border-emerald-500/25 rounded-xl p-4 font-mono">
                              <p className="text-emerald-400 text-xs mb-2">$ ./analyze.sh --roast</p>
                              <p className="text-emerald-300 font-bold text-lg leading-relaxed">{sec.lines[0] || ''}</p>
                              {sec.lines.slice(1).map((l, j) => <p key={j} className="text-emerald-400/60 text-xs mt-1">{l}</p>)}
                              <p className="text-emerald-500/40 text-xs mt-2 animate-pulse">$ _</p>
                            </div>}
                            {sec.emoji === '🏅' && <div className="text-center py-2">
                              <div className="inline-block px-6 py-4 bg-gradient-to-br from-amber-500/25 to-amber-600/10 border border-amber-500/30 rounded-xl shadow-lg shadow-amber-900/20">
                                <p className="text-4xl mb-2">🏆</p>
                                <p className="text-2xl font-black text-amber-400 tracking-wide">{sec.lines[0]?.replace(/[「」]/g,'') || ''}</p>
                                {sec.lines.slice(1).map((l, j) => <p key={j} className="text-amber-300/70 text-sm mt-1">{l}</p>)}
                              </div>
                            </div>}
                            {!['⚠️','🤖','🏅'].includes(sec.emoji) && sec.lines.map((l, j) => <p key={j} className="text-sm text-slate-300 leading-relaxed">{l}</p>)}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Page 2: 逐轮日志 */}
                    {recapPage === 2 && (
                      <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                        {state.judgeHistory.map((entry) => (
                          <details key={entry.round} className="bg-slate-800/40 border border-slate-700/20 rounded-xl overflow-hidden group">
                            <summary className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-slate-700/30 transition-colors">
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 ${
                                  entry.suspicionChange <= 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                                }`}>
                                  {entry.round}
                                </span>
                                <div className="min-w-0">
                                  <p className="text-sm text-slate-300 font-medium truncate">{entry.playerMessage}</p>
                                  <p className="text-xs text-slate-500 mt-0.5 truncate">“{entry.feedback}”</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-3 shrink-0 ml-3">
                                <span className={`text-sm font-mono font-bold ${entry.suspicionChange <= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                  {entry.suspicionChange > 0 ? '+' : ''}{entry.suspicionChange}%
                                </span>
                                <span className={`w-1 h-8 rounded-full ${entry.suspicionChange <= 0 ? 'bg-emerald-500/40' : 'bg-red-500/40'}`} />
                              </div>
                            </summary>
                            <div className="px-4 py-3 border-t border-slate-700/20 space-y-3">
                              <div className="flex flex-wrap gap-4">
                                {[
                                  { label: '圈内感', value: entry.breakdown?.belonging ?? 5, color: 'text-blue-400' },
                                  { label: '身份自洽', value: entry.breakdown?.consistency ?? 5, color: 'text-amber-400' },
                                  { label: '存在感', value: entry.breakdown?.presence ?? 5, color: 'text-emerald-400' },
                                  { label: '局势应对', value: entry.breakdown?.bonus ?? 0, color: 'text-violet-400' },
                                ].map(d => (
                                  <div key={d.label} className="flex items-center gap-2">
                                    <span className="text-[10px] text-slate-500 uppercase font-bold">{d.label}</span>
                                    <span className={`text-sm font-mono font-bold ${d.color}`}>
                                      {d.value > 0 ? '+' : ''}{d.value}
                                    </span>
                                  </div>
                                ))}
                              </div>
                              <p className="text-sm text-slate-400 italic">“{entry.feedback}”</p>
                            </div>
                          </details>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
              <button onClick={startGame}
                className="px-8 py-3 bg-white text-slate-950 rounded-xl font-bold hover:bg-white/90 transition-all flex items-center gap-2 mx-auto">
                <RefreshCw className="w-4 h-4" />重新开始
              </button>
            </motion.div>
          ) : (
            /* ── 胜利画面 ── */
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="max-w-4xl mx-auto p-8 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-center space-y-6 relative overflow-hidden">
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                {['🎉','🏆','✨','🎊','👏','🌟','💚','🎯'].map((e,i) => (
                  <motion.span key={i} className="absolute text-lg"
                    initial={{ opacity: 0, y: -20, x: Math.random()*300-150 }}
                    animate={{ opacity: [0,1,0], y: [Math.random()*200-100, Math.random()*300+100], x: [Math.random()*200-100, Math.random()*300-150] }}
                    transition={{ duration: 2+Math.random()*2, repeat: Infinity, delay: i*0.3 }}
                  >{e}</motion.span>
                ))}
              </div>
              <div className="relative z-10">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-emerald-600/20 rounded-full">
                <Award className="w-10 h-10 text-emerald-400" />
              </div>
              <div className="space-y-2">
                <h3 className="text-3xl font-bold text-emerald-400">成功摸鱼！</h3>
                <p className="text-slate-300">
                  混了 <span className="text-emerald-400 font-bold">{state.rounds} 轮</span>，暴露指数 <span className="text-emerald-400 font-bold">{state.suspicion}%</span> —— 他们居然信了。
                </p>
                <p className="text-emerald-500/60 text-xs italic">论坛已向你发出合作邀请……至少他们以为你是一位资深同行。</p>
              </div>
              {isRecapLoading && !gameRecap && (
                <div className="flex items-center justify-center gap-2 text-slate-500 text-sm">
                  <RefreshCw className="w-4 h-4 animate-spin" />正在生成结业评语...
                </div>
              )}
              {gameRecap && (() => {
                const isDefeat = false;
                const timeline = computeSuspicionTimeline(state.judgeHistory);
                const stats = computeRecapStats(state.judgeHistory);

                const sections: { emoji: string; title: string; lines: string[] }[] = [];
                const rawLines = gameRecap.split('\n').filter(l => l.trim());
                // Pre-process: merge emoji-only lines with following content
                const mergedLines: string[] = [];
                for (let i = 0; i < rawLines.length; i++) {
                  const trimmed = rawLines[i].trim();
                  if (/^[\u{2600}-\u{27BF}\u{1F000}-\u{1FFFF}]/u.test(trimmed) && trimmed.length <= 3 && i + 1 < rawLines.length) {
                    mergedLines.push(trimmed + ' ' + rawLines[i + 1].trim());
                    i++;
                  } else {
                    mergedLines.push(rawLines[i]);
                  }
                }
                let cur: typeof sections[0] | null = null;
                for (const line of mergedLines) {
                  const m = line.match(/^([\u{2600}-\u{27BF}\u{1F000}-\u{1FFFF}])\s*(.+)/u);
                  if (m) { if (cur) sections.push(cur); cur = { emoji: m[1], title: m[2], lines: [] }; }
                  else if (cur) cur.lines.push(line);
                }
                if (cur) sections.push(cur);

                const suspicionColor = (v: number) => v >= 85 ? 'text-fuchsia-400' : v >= 65 ? 'text-rose-400' : v >= 40 ? 'text-amber-400' : 'text-emerald-400';
                const badgeText = isDefeat ? 'CLASSIFIED' : 'DECLASSIFIED';

                return (
                  <div className="bg-slate-900/95 border border-slate-600/30 rounded-2xl p-6 text-left relative overflow-hidden shadow-2xl space-y-5"
                    style={{ backdropFilter: 'blur(8px)' }}>
                    <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent ${isDefeat ? 'via-amber-500/40' : 'via-emerald-500/40'} to-transparent`} />
                    <div className={`absolute top-4 right-4 text-[10px] font-bold ${isDefeat ? 'text-rose-500/40 border-rose-500/30' : 'text-emerald-500/40 border-emerald-500/30'} px-2 py-0.5 rounded rotate-12`}>{badgeText}</div>

                    {/* 三页标签 */}
                    <div className="flex gap-1 bg-slate-800/60 rounded-xl p-1">
                      {[
                        { id: 0, label: '📊', text: '数据' },
                        { id: 1, label: '🤖', text: 'AI复盘' },
                        { id: 2, label: '📜', text: '逐轮日志' },
                      ].map(tab => (
                        <button key={tab.id} onClick={() => setRecapPage(tab.id)}
                          className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                            recapPage === tab.id 
                              ? 'bg-slate-700 text-white shadow-lg' 
                              : 'text-slate-500 hover:text-slate-300'
                          }`}>
                          {tab.label} {tab.text}
                        </button>
                      ))}
                    </div>

                    {/* Page 0: 数据仪表盘 */}
                    {recapPage === 0 && (
                      <div className="space-y-5">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          {[
                            { label: '存活轮次', value: `${state.rounds}`, color: 'text-blue-400' },
                            { label: '最终暴露', value: `${state.suspicion}%`, color: suspicionColor(state.suspicion) },
                            { label: '最佳一轮', value: stats ? `${stats.best}%` : '-', sub: stats?.bestRound.feedback, color: 'text-emerald-400' },
                            { label: '最差一轮', value: stats ? `${stats.worst > 0 ? '+' : ''}${stats.worst}%` : '-', sub: stats?.worstRound.feedback, color: 'text-red-400' },
                          ].map(card => (
                            <div key={card.label} className="bg-slate-800/60 border border-slate-700/30 rounded-xl p-4 text-center">
                              <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">{card.label}</p>
                              <p className={`text-2xl font-black mt-1 ${card.color}`}>{card.value}</p>
                              {card.sub && <p className="text-[10px] text-slate-500 mt-1 line-clamp-1">{card.sub}</p>}
                            </div>
                          ))}
                        </div>

                        <div className="bg-slate-800/60 border border-slate-700/30 rounded-xl p-5">
                          <p className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-4">暴露指数趋势</p>
                          <div className="relative h-32">
                            <svg className="w-full h-full" viewBox="0 0 240 120" preserveAspectRatio="none">
                              <rect x="0" y="20" width="240" height="28" fill="rgba(52,211,153,0.08)" rx="2" />
                              <rect x="0" y="48" width="240" height="17.5" fill="rgba(251,191,36,0.08)" rx="2" />
                              <rect x="0" y="65.5" width="240" height="14" fill="rgba(244,63,94,0.08)" rx="2" />
                              <rect x="0" y="79.5" width="240" height="24.5" fill="rgba(217,70,239,0.08)" rx="2" />
                              {timeline.length > 1 && (
                                <polyline fill="none" stroke="rgba(148,163,184,0.8)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
                                  points={timeline.map((t, i) => `${i * (240 / (timeline.length - 1))},${120 - (t.suspicion / 100) * 100}`).join(' ')} />
                              )}
                              {timeline.map((t, i) => (
                                <circle key={i} cx={timeline.length > 1 ? i * (240 / (timeline.length - 1)) : 120}
                                  cy={120 - (t.suspicion / 100) * 100} r="4"
                                  fill={t.suspicion >= 85 ? '#d946ef' : t.suspicion >= 65 ? '#f43f5e' : t.suspicion >= 40 ? '#fbbf24' : '#34d399'}
                                  stroke="rgba(0,0,0,0.5)" strokeWidth="1.5" />
                              ))}
                            </svg>
                            <div className="flex justify-between mt-1 text-[10px] text-slate-600 font-mono">
                              {timeline.filter((_, i) => i === 0 || i === timeline.length - 1 || i === Math.floor(timeline.length / 2)).map(t => (
                                <span key={t.round}>R{t.round}</span>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="bg-slate-800/60 border border-slate-700/30 rounded-xl p-5">
                          <p className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-4">三维评分走势</p>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            {(['belonging', 'consistency', 'presence'] as const).map(dim => {
                              const values = state.judgeHistory.map(h => h.breakdown?.[dim] ?? 5);
                              const avg = values.reduce((a, b) => a + b, 0) / values.length;
                              const dimLabels: Record<string, string> = { belonging: '圈内感', consistency: '身份自洽', presence: '存在感' };
                              const dimColors: Record<string, string> = { belonging: 'text-blue-400', consistency: 'text-amber-400', presence: 'text-emerald-400' };
                              return (
                                <div key={dim} className="text-center">
                                  <p className={`text-[10px] uppercase font-bold tracking-wider ${dimColors[dim]}`}>{dimLabels[dim]}</p>
                                  <p className="text-2xl font-black text-white mt-1">{avg.toFixed(1)}</p>
                                  <p className="text-[10px] text-slate-500">平均分</p>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Page 1: AI 深度复盘 */}
                    {recapPage === 1 && (
                      <div className="space-y-5">
                        {sections.filter(s => s.emoji !== '🎭').map((sec, i) => (
                          <div key={i} className="border-t border-slate-800 first:border-t-0 pt-4 first:pt-0">
                            <div className="flex items-center gap-2 mb-3">
                              <span className="text-lg">{sec.emoji}</span>
                              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{sec.title}</span>
                            </div>
                            {sec.emoji === '⚠️' && sec.lines.map((l, j) =>
                              j === 0
                                ? <p key={j} className="text-3xl font-black text-red-400 leading-tight" style={{textShadow:'0 0 30px rgba(239,68,68,0.4)'}}>{l}</p>
                                : <p key={j} className="text-base text-slate-200 leading-relaxed">{l}</p>
                            )}
                            {sec.emoji === '🤖' && <div className="bg-black/80 border border-emerald-500/25 rounded-xl p-4 font-mono">
                              <p className="text-emerald-400 text-xs mb-2">$ ./analyze.sh --roast</p>
                              <p className="text-emerald-300 font-bold text-lg leading-relaxed">{sec.lines[0] || ''}</p>
                              {sec.lines.slice(1).map((l, j) => <p key={j} className="text-emerald-400/60 text-xs mt-1">{l}</p>)}
                              <p className="text-emerald-500/40 text-xs mt-2 animate-pulse">$ _</p>
                            </div>}
                            {sec.emoji === '🏅' && <div className="text-center py-2">
                              <div className="inline-block px-6 py-4 bg-gradient-to-br from-amber-500/25 to-amber-600/10 border border-amber-500/30 rounded-xl shadow-lg shadow-amber-900/20">
                                <p className="text-4xl mb-2">🏆</p>
                                <p className="text-2xl font-black text-amber-400 tracking-wide">{sec.lines[0]?.replace(/[「」]/g,'') || ''}</p>
                                {sec.lines.slice(1).map((l, j) => <p key={j} className="text-amber-300/70 text-sm mt-1">{l}</p>)}
                              </div>
                            </div>}
                            {!['⚠️','🤖','🏅'].includes(sec.emoji) && sec.lines.map((l, j) => <p key={j} className="text-sm text-slate-300 leading-relaxed">{l}</p>)}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Page 2: 逐轮日志 */}
                    {recapPage === 2 && (
                      <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                        {state.judgeHistory.map((entry) => (
                          <details key={entry.round} className="bg-slate-800/40 border border-slate-700/20 rounded-xl overflow-hidden group">
                            <summary className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-slate-700/30 transition-colors">
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 ${
                                  entry.suspicionChange <= 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                                }`}>
                                  {entry.round}
                                </span>
                                <div className="min-w-0">
                                  <p className="text-sm text-slate-300 font-medium truncate">{entry.playerMessage}</p>
                                  <p className="text-xs text-slate-500 mt-0.5 truncate">“{entry.feedback}”</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-3 shrink-0 ml-3">
                                <span className={`text-sm font-mono font-bold ${entry.suspicionChange <= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                  {entry.suspicionChange > 0 ? '+' : ''}{entry.suspicionChange}%
                                </span>
                                <span className={`w-1 h-8 rounded-full ${entry.suspicionChange <= 0 ? 'bg-emerald-500/40' : 'bg-red-500/40'}`} />
                              </div>
                            </summary>
                            <div className="px-4 py-3 border-t border-slate-700/20 space-y-3">
                              <div className="flex flex-wrap gap-4">
                                {[
                                  { label: '圈内感', value: entry.breakdown?.belonging ?? 5, color: 'text-blue-400' },
                                  { label: '身份自洽', value: entry.breakdown?.consistency ?? 5, color: 'text-amber-400' },
                                  { label: '存在感', value: entry.breakdown?.presence ?? 5, color: 'text-emerald-400' },
                                  { label: '局势应对', value: entry.breakdown?.bonus ?? 0, color: 'text-violet-400' },
                                ].map(d => (
                                  <div key={d.label} className="flex items-center gap-2">
                                    <span className="text-[10px] text-slate-500 uppercase font-bold">{d.label}</span>
                                    <span className={`text-sm font-mono font-bold ${d.color}`}>
                                      {d.value > 0 ? '+' : ''}{d.value}
                                    </span>
                                  </div>
                                ))}
                              </div>
                              <p className="text-sm text-slate-400 italic">“{entry.feedback}”</p>
                            </div>
                          </details>
                        ))}
                      </div>
                    )}

                    {/* Victory button */}
                    <button onClick={startGame}
                      className="w-full mt-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-base transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/30">
                      <RefreshCw className="w-4 h-4" />再来一次
                    </button>
                  </div>
                );
              })()}
              </div> {/* close relative z-10 */}
            </motion.div>
          )
        ) : (<div>
          <form onSubmit={handleSubmit} className="max-w-4xl mx-auto flex gap-3">
            <div className="relative flex-1 flex gap-2">
              <input
                autoFocus
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={`参与关于 ${state.topic} 的讨论...`}
                className={`flex-1 rounded-xl px-5 py-4 focus:outline-none focus:ring-2 text-sm transition-all duration-500 ${
                  state.suspicion >= 85 ? 'bg-red-950/50 border-red-500/40 focus:ring-red-500/50 text-slate-100 placeholder:text-slate-400/60' :
                  state.suspicion >= 65 ? 'bg-red-950/20 border-red-500/20 focus:ring-red-500/30 text-slate-100' :
                  state.suspicion >= 40 ? 'bg-amber-950/10 border-amber-500/15 focus:ring-amber-500/30 text-slate-100' :
                  'bg-slate-950 border-white/10 focus:ring-blue-500/50 text-slate-100'
                }`}
              />
            </div>
            <button
              type="submit"
              disabled={!inputValue.trim() || isTyping}
              className={`rounded-xl flex items-center justify-center transition-all shadow-lg shrink-0 w-14 ${
                state.suspicion >= 85 ? 'bg-red-600 hover:bg-red-500 disabled:bg-slate-800 shadow-red-900/30 animate-pulse' :
                state.suspicion >= 65 ? 'bg-red-600/80 hover:bg-red-500 disabled:bg-slate-800 shadow-red-900/20' :
                state.suspicion >= 40 ? 'bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 shadow-amber-900/20' :
                'bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 shadow-blue-900/20'
              } disabled:opacity-50 text-white`}
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
          {inputSuggestion && (
            <div className="max-w-4xl mx-auto mt-1 px-1">
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="text-xs text-amber-400/80 italic">{inputSuggestion}</motion.p>
            </div>
          )}
        </div>)}
      </footer>

      {/* Suspicion warning overlays */}
      {state.suspicion >= 90 && state.status === 'playing' && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 pointer-events-none z-50">
          <motion.div 
            animate={{ scale: [1, 1.08, 1], opacity: [0.7, 1, 0.7] }}
            transition={{ repeat: Infinity, duration: 0.8 }}
            className="flex items-center gap-2 px-4 py-2 bg-red-700 text-white rounded-full text-sm font-black uppercase tracking-[0.2em] shadow-2xl shadow-red-900/60"
          >
            <AlertCircle className="w-4 h-4 animate-pulse" />
            极度危险 · 身份濒临暴露
          </motion.div>
        </div>
      )}
      {state.suspicion >= 70 && state.suspicion < 90 && state.status === 'playing' && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 pointer-events-none z-50">
          <motion.div 
            animate={{ opacity: [0.5, 0.9, 0.5] }}
            transition={{ repeat: Infinity, duration: 2 }}
            className="px-4 py-1.5 bg-red-500/20 border border-red-500/30 text-red-400 rounded-full text-xs font-bold backdrop-blur-sm"
          >
            他们开始怀疑了...
          </motion.div>
        </div>
      )}
      {state.suspicion >= 40 && state.suspicion < 70 && state.status === 'playing' && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 pointer-events-none z-50">
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 0.7 }}
            className="px-3 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-400/70 rounded-full text-[10px] backdrop-blur-sm"
          >
            气氛有些微妙
          </motion.div>
        </div>
      )}

      {/* Score popup overlay */}
      <AnimatePresence>
        {scorePopup && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[200] flex items-center justify-center pointer-events-none"
            style={{ background: scorePopup.change < 0 ? 'rgba(0,30,20,0.5)' : 'rgba(30,0,0,0.5)', backdropFilter: 'blur(8px)' }}
            onClick={() => setScorePopup(null)}>
            
            {/* Side glow bars */}
            <div className={`absolute inset-y-0 w-1 pointer-events-none transition-all duration-300 ${scorePopup.change < 0 ? 'left-0 bg-gradient-to-r from-emerald-500/40 to-transparent' : 'left-0 bg-gradient-to-r from-red-500/40 to-transparent'}`} />
            <div className={`absolute inset-y-0 w-1 pointer-events-none transition-all duration-300 ${scorePopup.change < 0 ? 'right-0 bg-gradient-to-l from-emerald-500/40 to-transparent' : 'right-0 bg-gradient-to-l from-red-500/40 to-transparent'}`} />

            <div className="text-center space-y-4">
              {/* Big score */}
              <motion.div
                initial={{ scale: 0.3, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 200, damping: 10 }}
              >
                <span className={`text-8xl font-black ${scorePopup.change < 0 ? 'text-emerald-400' : 'text-red-400'}`}
                  style={{ textShadow: scorePopup.change < 0 
                    ? '0 0 80px rgba(52,211,153,0.6), 0 0 120px rgba(52,211,153,0.3)'
                    : '0 0 80px rgba(248,113,113,0.6), 0 0 120px rgba(248,113,113,0.3)' }}>
                  {scorePopup.change > 0 ? `+${scorePopup.change}` : scorePopup.change}%
                </span>
              </motion.div>

              {/* Direction label */}
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className={`text-xl font-black uppercase tracking-[0.3em] ${scorePopup.change < 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                {scorePopup.change < 0 ? '↓ 暴露指数降低' : '↑ 暴露指数上升'}
              </motion.p>

              {/* Expert feedback */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 }}
                className={`mx-auto max-w-md px-6 py-3 rounded-2xl border backdrop-blur-sm ${
                  scorePopup.change < 0 
                    ? 'bg-emerald-500/10 border-emerald-500/30' 
                    : 'bg-red-500/10 border-red-500/30'
                }`}>
                <p className="text-white text-xl font-bold">{scorePopup.feedback}</p>
              </motion.div>

              {/* Emoji verdict */}
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="text-4xl">
                {scorePopup.change < 0 ? '👏😎💪' : '😅😰💦'}
              </motion.p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Glossary Modal */}
      <AnimatePresence>
      </AnimatePresence>
    </div>
  );
}
