/**
 * 困难模式生存示范
 * 用一个"身份构造大师"AI 玩家模拟活过困难模式 10 轮
 */

import { generateGameStart, generateSingleNPCReply, judgeRound, generateGameRecap } from './src/services/ai';
import { Message, Difficulty, NPCPersonality } from './src/types';
import OpenAI from 'openai';

const DIFF: Difficulty = 'hard';
const REQUIRED_ROUNDS = 10;
const DEEPSEEK_KEY = () => {
  if (typeof window !== 'undefined') return '';
  return process.env.DEEPSEEK_API_KEY || '';
};

// ── "完美玩家" AI 引擎 ──
async function perfectPlayer(npcDialogue: string[], history: string, topic: string, field: string, rounds: number): Promise<string> {
  const client = new OpenAI({
    apiKey: DEEPSEEK_KEY(),
    baseURL: "https://api.deepseek.com",
  });
  const prompt = `你是一个社交伪装大师，正在一个群聊中扮演圈内人。你的目标：让所有人觉得你是"自己人"，抓住一切机会展示圈内洞察力。

当前场景：${field}，讨论话题：${topic}
已进行 ${rounds} 轮对话。

## 你的策略
1. 用这个圈子的话语方式说话（学术话题就用术语，八卦话题就用共鸣语气）
2. 关注上一个人发言中的漏洞或可接的点
3. 如果 NPC 说错了什么，自然地点出来，不要生硬
4. 如果没什么好说的，就顺着对方的话题做一个有信息的补充
5. 保持节奏和长度和其他人同步，不要太长不要太短

## 最近对话
${history || '暂无'}

## 上几位群友的发言
${npcDialogue.map((d, i) => `群友${i + 1}: ${d}`).join('\n')}

请生成你的下一轮发言（20-50字，自然、有信息量、像圈内人）。直接返回发言内容，不要有多余文字。`;

  const res = await client.chat.completions.create({
    model: "deepseek-v4-flash",
    messages: [{ role: "user", content: prompt }],
  });
  return res.choices[0].message.content || '有点意思，我之前没想到这个角度。';
}

async function main() {
  console.log('🎮 FAKE | 身份流亡 — 困难模式生存示范\n');
  console.log(`难度: 困难 (评分权重 ×2.0) | 目标: 存活 ${REQUIRED_ROUNDS} 轮\n`);

  // ── 1. 开局 ──
  const start = await generateGameStart(DIFF);
  const { field, topic, initialExperts, npcs } = start;
  const npcNames = npcs.map(n => n.name).join('、');
  console.log(`📋 领域: ${field}`);
  console.log(`📋 话题: ${topic}`);
  console.log(`👥 NPC: ${npcNames}\n`);

  // ── 2. 构建消息历史 ──
  let messages: Message[] = initialExperts.map((exp: any, i: number) => ({
    id: `init-${i}`,
    role: 'expert' as const,
    author: exp.author,
    content: exp.content,
    timestamp: new Date(),
    npcId: npcs[i % npcs.length]?.id || `npc_${i}`,
  }));

  // ── 3. 开始逐轮 ──
  let suspicion = 15;
  let judgeHistory: any[] = [];
  let transcript = `# FAKE | 困难模式生存典范\n\n`;
  transcript += `> 领域: ${field}  |  话题: ${topic}  |  NPC: ${npcNames}\n\n`;
  transcript += `---\n\n`;
  transcript += `## 开场\n\n`;

  // 输出开场
  for (const msg of messages) {
    const tag = msg.role === 'player' ? '🧑' : '🤖';
    transcript += `### ${msg.author}\n> ${msg.content}\n\n`;
  }

  for (let round = 1; round <= REQUIRED_ROUNDS; round++) {
    console.log(`\n━━━ 第 ${round} 轮 ━━━`);
    transcript += `---\n\n## 第 ${round} 轮\n\n`;

    // ── 3a. 生成玩家回复 ──
    const lastNpc = messages.filter(m => m.role === 'expert').slice(-4);
    const npcDialogue = lastNpc.map(m => m.content);
    const history = messages.map(m => `${m.author}: ${m.content}`).slice(-8).join('\n');

    const playerText = await perfectPlayer(npcDialogue, history, topic, field, round);
    console.log(`🧑 玩家: ${playerText}`);

    const playerMsg: Message = {
      id: `p-${Date.now()}`,
      role: 'player',
      author: '你（身份流亡者）',
      content: playerText,
      timestamp: new Date(),
    };
    messages.push(playerMsg);
    transcript += `### 你（身份流亡者）\n> ${playerText}\n\n`;

    // ── 3b. 评审 ──
    const prevNpcDialogue = messages
      .filter(m => m.role === 'expert' && m.npcId)
      .slice(-4)
      .map(m => ({ npcId: m.npcId || '', content: m.content }));

    const playerHistory = messages
      .filter(m => m.role === 'player')
      .slice(-5)
      .map(m => m.content)
      .join('\n---\n');

    const judge = await judgeRound(playerText, prevNpcDialogue, npcs, playerHistory, suspicion, round, DIFF);

    const b = judge.breakdown || { belonging: 5, consistency: 5, presence: 5, bonus: 0 };
    const DIFF_WEIGHT = 2.0;
    const avgScore = (b.belonging + b.consistency + b.presence) / 3;
    const suspicionIncrease = judge.surrender ? 50 : Math.round(avgScore * DIFF_WEIGHT + (b.bonus || 0));
    suspicion = Math.max(0, Math.min(100, suspicion + suspicionIncrease));

    judgeHistory.push({
      round,
      playerMessage: playerText,
      feedback: judge.feedback,
      suspicionChange: suspicionIncrease,
      breakdown: b,
    });

    console.log(`📊 评审: ${judge.feedback}`);
    console.log(`📊 打分: 圈内感=${b.belonging} 自洽=${b.consistency} 存在感=${b.presence} 局势=${b.bonus > 0 ? '+' : ''}${b.bonus}`);
    console.log(`📊 增量: ${suspicionIncrease > 0 ? '+' : ''}${suspicionIncrease} → 暴露指数: ${suspicion}%`);

    transcript += `> 📊 **身份审判**: ${judge.feedback}\n`;
    transcript += `> 圈内感 ${b.belonging}/10 · 身份自洽 ${b.consistency}/10 · 存在感 ${b.presence}/10 · 局势应对 ${b.bonus > 0 ? '+' : ''}${b.bonus}\n`;
    transcript += `> 🎯 暴露指数变动: ${suspicionIncrease > 0 ? '+' : ''}${suspicionIncrease}% → **${suspicion}%**\n\n`;

    // ── 失败检查 ──
    if (suspicion >= 100 || judge.surrender) {
      console.log(`\n💀 第 ${round} 轮暴露! 暴露指数: ${suspicion}%`);
      transcript += `> 💀 **身份崩解，流亡失败。**\n\n`;
      transcript += `---\n\n## 结局：流亡失败\n\n`;
      transcript += `在第 ${round} 轮暴露指数达到 ${suspicion}%，身份被识破。`;
      break;
    }

    // ── 3c. 生成 NPC 回复 ──
    const dialogue: { npcId: string; content: string }[] = [];
    const shuffled = [...npcs].sort(() => Math.random() - 0.5).slice(0, 4);

    for (let i = 0; i < shuffled.length; i++) {
      const npc = shuffled[i];
      const prevContent = i > 0 ? dialogue[i - 1].content : null;
      const content = await generateSingleNPCReply(npc, topic, round, playerText, prevContent, messages, DIFF);
      dialogue.push({ npcId: npc.id, content });

      const npcMsg: Message = {
        id: `npc-${Date.now()}-${i}`,
        role: 'expert' as const,
        author: npc.name,
        content,
        timestamp: new Date(),
        npcId: npc.id,
      };
      messages.push(npcMsg);

      console.log(`🤖 ${npc.name}: ${content}`);
      transcript += `### ${npc.name}\n> ${content}\n\n`;
    }

    // ── 胜利检查 ──
    if (round >= REQUIRED_ROUNDS && suspicion < 100) {
      console.log(`\n🎉 流亡成功! 存活 ${round} 轮，最终暴露指数 ${suspicion}%`);
      transcript += `---\n\n## 结局：流亡成功 🎉\n\n`;
      transcript += `存活 ${round} 轮，最终暴露指数 ${suspicion}%。身份构造未被识破，成功融入。\n\n`;
    }
  }

  // ── 4. 生成复盘报告 ──
  console.log(`\n📋 生成复盘报告...`);
  try {
    const recap = await generateGameRecap(field, topic, messages.length, suspicion, messages, npcs, judgeHistory);
    transcript += `---\n\n## AI 复盘报告\n\n${recap}`;
  } catch {
    transcript += `\n\n*（复盘报告生成失败）*`;
  }

  // ── 5. 写入文件 ──
  const fs = await import('fs');
  fs.writeFileSync('./生存典范.md', transcript, 'utf-8');
  console.log(`\n✅ 已保存到 生存典范.md`);
}

main().catch(e => {
  console.error('❌ 失败:', e);
  process.exit(1);
});
