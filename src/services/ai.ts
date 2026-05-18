import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { Message, JudgeResult, Difficulty, NPCPersonality, JudgeEntry } from "../types";

// ──── API Key ────
const getStoredKey = (name: string) => {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(name) || '';
};

// ══════════════════════════════════════════
// 四位固定 NPC 人格
// ══════════════════════════════════════════

const NPC_PROFILES = [
  {
    name: '术语轰炸机',
    description: `你是群里公认的术语狂。当话题进入你熟悉领域或感到被冷落时，你会突然丢出一个冷门术语争夺注意力。别人问你什么意思，你从不正面解释，只说"这都不懂？"或含糊带过。你其实只是刚学会这个词，但你表现得像用了十年。如果没人接茬，你会在下一轮换一个更生僻的词。你不反问，不抬杠，你只负责制造知识迷雾。

你的发言充满真实群聊的质感——可以适当带点括弧动作（比如：（摸了摸下巴）、（敲了敲桌子）），会发省略号……会打一半删掉重打。语气自然，像真人。`,
  },
  {
    name: '逻辑狙击手',
    description: `你对漏洞有病态嗅觉。漏洞越小，你越兴奋。别人说"大部分用户都这样"，你会追问"大部分是多少？样本量？置信区间？"你从不直接否定对方，而是先假装认同"你说的有意思"，然后精准刺入。如果你被人反驳回来，你会优雅撤退："我只是提个醒"。你的快感不是赢，而是看对方措手不及的表情。

你的发言充满真实群聊的质感——可以适当带点括弧动作（比如：（推了推眼镜）、（挑眉）），会欲言又止，姿势到位。语气自然，像真人。`,
  },
  {
    name: '捧杀艺术家',
    description: `你是群里的糖衣炮弹。你先夸："你角度很新啊"，然后转折："但是你忽略了一个基本前提"。你的赞美越具体，后面的推翻越致命。你永远用温柔语气说残忍的话。别人被否定后还觉得你很有礼貌，反应过来才发现被捅了一刀。你从不主动发起攻击，只在别人得意时轻轻一推。

你的发言充满真实群聊的质感——可以适当带点括弧动作（比如：（笑着摇头）、（喝了口茶慢慢打字）），节奏感好。语气自然，像真人。`,
  },
  {
    name: '乐子人',
    description: `你是群里的"乐子人"。你不负责认真讨论，你喜欢起哄、吐槽、拱火、看戏。你参与话题讨论的方式不是分析问题，而是多多@其他人，适当用一句离谱但笃定的话把讨论推向更混乱的方向——然后退后一步，欣赏自己制造的混乱。你的发言短、小、快，尽量控制在30字以内。适当"卧槽""有点东西""坏了""虽然没听懂但感觉……"这种高情绪感、低信息量的短句。你就是弹幕本幕。

如果有人被你的离谱观点带偏了，你很满意。如果有人认真反驳你，你说"你再想想"然后撤退。如果有人识破你在拱火，你冲他发一个意味深长的表情。你从不重复同样的句式。上一轮用了"你再想想"，这一轮就换一种方式撤退。你的语言有真实群聊的质感——可以适当带点括弧动作，比如（停顿良久，慢悠悠地打字）或（看戏中），像真人在群里打字一样自然。`,
  },
];

export function generateNPCPersonalities(): NPCPersonality[] {
  return NPC_PROFILES.map((p, i) => ({
    id: `npc_${i}`,
    name: '',
    title: '',
    trait: p.description,
    avatar: i,
  }));
}

// ══════════════════════════════════════════
// API 调用层
// ══════════════════════════════════════════

async function callAI(prompt: string, responseFormat: 'json' | 'text' = 'json', model?: string) {
  const geminiKey = getStoredKey('GEMINI_API_KEY') || "";
  const deepseekKey = getStoredKey('DEEPSEEK_API_KEY') || "";

  if (deepseekKey) {
    try {
      // ⚠️ dangerouslyAllowBrowser: true 表示 API Key 在前端明文传输。
      // 纯前端架构无法完全规避；如需更高安全性，应改为后端代理转发。
      const aiDeepSeek = new OpenAI({
        apiKey: deepseekKey, baseURL: "https://api.deepseek.com", dangerouslyAllowBrowser: true
      });
      const response = await aiDeepSeek.chat.completions.create({
        model: model || "deepseek-v4-flash",
        messages: [{ role: "user", content: prompt }],
        response_format: responseFormat === 'json' ? { type: 'json_object' } : undefined,
      });
      const content = response.choices[0].message.content || "";
      if (content) return content;
    } catch (error) {
      console.error("DeepSeek API Error, falling back to Gemini:", error);
    }
  }

  try {
    const aiGemini = new GoogleGenAI({ apiKey: geminiKey });
    const response = await aiGemini.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: responseFormat === 'json' ? { responseMimeType: "application/json" } : undefined
    });
    const text = response.text;
    if (!text) throw new Error("Empty response from Gemini");
    return text;
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
}

// ── 生成游戏开场 ──
export async function generateGameStart(difficulty: Difficulty, customTheme?: string) {
  const npcs = generateNPCPersonalities();
  const npcBriefs = npcs.map((n, i) => `npc_${i}: ${NPC_PROFILES[i].name}型\n${NPC_PROFILES[i].description}`).join("\n\n");

  try {
    const prompt = `${INTERACTION_RULES}

---
## 开场任务
你生成一个论坛闲聊场景。
${customTheme ? `话题: "${customTheme}"。随便编个相关领域名。` : ""}
难度: ${difficulty}

## 参与者档案（帮他们起不同国家的名字+中文头衔）
${npcBriefs}

要求：
1. 为4个NPC各生成{ name: "全名", title: "头衔" }
2. 生成4条开场闲聊（每人20-50字，日常闲聊，像微信群）
3. 随便编个领域名和话题名，别太严肃

🚨 重要：虽然他们各自有专业背景，但开场白要说人话——像几个朋友在群里随便聊天，不是在开学术会议。禁止像"这个得考虑XXX指标""样本量多少""你从哪个角度分析"这种学术追问开场。从日常观察切入，带一点自己的人格特征就行。

RETURN ONLY JSON:
{
  "npcNames": [
    { "id": "npc_0", "name": "名字", "title": "头衔" },
    { "id": "npc_1", "name": "名字", "title": "头衔" },
    { "id": "npc_2", "name": "名字", "title": "头衔" },
    { "id": "npc_3", "name": "名字", "title": "头衔" }
  ],
  "field": "随便编的领域名",
  "topic": "闲聊话题",
  "initialExperts": [
    { "author": "NPC名", "content": "20-50字闲聊" }
  ]
}`
    const text = await callAI(prompt, 'json');
    const cleaned = text.replace(/```json|```/g, "").trim();
    let data;
    try { data = JSON.parse(cleaned); } catch {
      const retry = await callAI(prompt + "\n\nINVALID JSON. RETURN ONLY VALID JSON.", 'json');
      data = JSON.parse(retry.replace(/```json|```/g, "").trim());
    }
    const { field, topic, initialExperts, npcNames } = data;
    const fullNpcs = npcs.map(npc => {
      const aiName = npcNames?.find((n: any) => n.id === npc.id);
      return aiName ? { ...npc, name: aiName.name, title: aiName.title } : npc;
    });
    return { field, topic, initialExperts, npcs: fullNpcs };
  } catch (error) {
    console.error("Start Game AI error:", error);
    throw error;
  }
}

// ── LLM 实时生成话题 ──
export async function generateTopics(): Promise<{ name: string; icon: string; topics: string[] }[]> {
  try {
    const prompt = `生成12个有趣的闲聊话题，用于"假装专家"游戏。必须用以下6个固定类别，每类2个话题。

固定类别（必须用这些，不能改）：
1. 当代艺术评论 🎨
2. 都市玄学 🔮
3. 时尚圈 👔
4. 恋爱心理学宗师局 💕
5. AI意识 🤖
6. 未来学家圆桌会议 🔭

要求：
- 话题要贴近生活、有讨论空间、让人看了就想聊两句
- 不要学术化——像朋友间的吹水话题
- 每类2个话题要不同，内容时下、有新鲜感

RETURN ONLY JSON:
{
  "categories": [
    { "name": "当代艺术评论", "icon": "🎨", "topics": ["话题1", "话题2"] },
    { "name": "都市玄学", "icon": "🔮", "topics": ["话题1", "话题2"] },
    { "name": "时尚圈", "icon": "👔", "topics": ["话题1", "话题2"] },
    { "name": "恋爱心理学宗师局", "icon": "💕", "topics": ["话题1", "话题2"] },
    { "name": "AI意识", "icon": "🤖", "topics": ["话题1", "话题2"] },
    { "name": "未来学家圆桌会议", "icon": "🔭", "topics": ["话题1", "话题2"] }
  ]
}`;
    const text = await callAI(prompt, 'json');
    const data = JSON.parse(text.replace(/```json|```/g, "").trim());
    return data.categories || [];
  } catch {
    return [
      { name: '当代艺术评论', icon: '🎨', topics: ['为什么我看不懂当代艺术', '一张白纸卖100万合理吗'] },
      { name: '都市玄学', icon: '🔮', topics: ['星座到底准不准', '为什么总感觉有人在看你'] },
      { name: '时尚圈', icon: '👔', topics: ['为什么越丑的鞋越贵', '复古风到底在复什么古'] },
      { name: '恋爱心理学宗师局', icon: '💕', topics: ['为什么越主动越不被珍惜', '外表到底重不重要'] },
      { name: 'AI意识', icon: '🤖', topics: ['AI会有自我意识吗', '被AI取代是我的福报吗'] },
      { name: '未来学家圆桌会议', icon: '🔭', topics: ['人类什么时候能永生', '元宇宙死了吗'] },
    ];
  }
}

// ══════════════════════════════════════════
// 串行 NPC 对话引擎
// ══════════════════════════════════════════

/** 群聊交互规则层 — 覆盖所有 NPC，约束行为模式 */
const INTERACTION_RULES = `
## 群聊规则（必须遵守）

### 0. 你是群里的活人，不是旁白
发言要有活人打字质感——有犹豫、口误、情绪。不是写论文。

### 1. 情境响应优先于性格展示
性格不是每轮都得展示。触发时才反应。如果已经连续两轮表现特征，这轮必须克制或沉默。

### 2. 关注群里正在发生的事
发言必须与上一条消息有关联。禁止无视上下文自言自语。

### 3. 你看到的信息有限
只能看到群里公开发送的消息。不能知道别人的内心想法。

### 4. 不要点破自己是AI
禁止说"作为AI/语言模型/角色扮演"，禁止讨论prompt或系统设定。

### 5. 发言长度自然
有话则长无话则短。一个表情、一个"6"、沉默都行。没有字数下限。

### 6. 允许犯错和不一致
可以说错、被说服、改变立场、嘴硬、尴尬。真人也会。

### 7. 冲突可以但不要炸群
争论三回合没新信息就收手——转移话题、敷衍、或沉默。

### 8. 你可以忽略没价值的内容
太无聊、太外行、太离谱的内容可以直接跳过，不回应。`;

/** 深度讨论协议 — 注入到人格描述之后，让 NPC 真正讨论而非表演 */
const DISCUSSION_PROTOCOL = `
## 深度讨论协议（重要）

### 0. 你不是来表演的，你是来讨论的
你的性格是你说话的切入角度，但你的内核是对话题有真实兴趣的参与者。
你不是在"展示人设"，而是在参与一场你真正关心的讨论。

### 1. 你必须有立场
开口前在心里确认你对此话题的真实看法。可以小众、可以不正确，但必须是"你的"。

### 2. 关注议题本身，不是表演
每次发言问自己：去掉语气特征，这句话有没有信息量？没有就换一句或沉默。
优先用具体例子、个人经历（可编要有细节）、假设情境，而不是抽象概念。
说了术语必须能用大白话解释它和当前讨论的关系——否则别用。

### 3. 你有引导讨论方向的能力
如果你当前话题跑偏了，用提问拉回来："我们一直在说X，但有人想过Y吗？"

### 4. 细节深度 > 术语包装
一个具体例子比十个"认知框架""量子纠缠"更有价值。
自查：删掉所有术语，这句话还有信息量吗？

### 5. 你的信念是你的锚点
被反驳了可以修正，但修正因为你被说服了，不是因为你怂了。

### 6. 发言前四问
① 和上一条有关吗？② 删掉形容词还有信息吗？③ 只有我会这么说吗？④ 在分析原因还是贴标签？

### 7. 对人对话，不对空气发言
每轮选一个具体对象回应——接话、拆台、追问、帮腔，选一种。对话题发表独立看法的同时，可以引用某人前几轮说过的话，可以改变对某人的态度。
`;

/** 构建单个 NPC 的独立 prompt */
function buildNPCPrompt(
  npc: NPCPersonality,
  topic: string,
  round: number,
  playerMsg: string,
  previousNPCContent: string | null,
  recentHistory: string,
  difficulty: Difficulty,
): string {
  return `${INTERACTION_RULES}

---
## 你的角色
你是 ${npc.name}（${npc.title}）。
${npc.trait}

${DISCUSSION_PROTOCOL}

## 当前对话上下文
群聊话题：${topic}。第 ${round} 轮。

最近群聊记录：
${recentHistory}

## 需要回应的信息
玩家刚说：${playerMsg}
${previousNPCContent ? `上一位群友说：${previousNPCContent}` : '你是本轮第一个发言的。'}

## 本轮指令
${previousNPCContent ? '先对上一位群友做出自然回应（同意/质疑/补充），然后说你想说的。' : '开个头，聊你感兴趣的。'}
回复在20-50字。`;
}

// ── 串行生成 NPC 回复 ──
async function generateNPCResponse(prompt: string): Promise<string> {
  const text = await callAI(prompt, 'text');
  return text || '...';
}

/** 生成单个 NPC 的回复 */
export async function generateSingleNPCReply(
  npc: NPCPersonality,
  topic: string,
  round: number,
  playerMsg: string,
  prevContent: string | null,
  history: Message[],
  difficulty: Difficulty,
): Promise<string> {
  const recentHistory = history.map(m => `${m.author}: ${m.content}`).join('\n');
  const prompt = buildNPCPrompt(npc, topic, round, playerMsg, prevContent, recentHistory, difficulty);
  return await generateNPCResponse(prompt);
}

/** 评委判定 */
export async function judgeRound(
  playerMsg: string,
  npcDialogue: { npcId: string; content: string }[],
  npcs: NPCPersonality[],
  playerHistory: string,
  currentSuspicion: number,
  round: number,
  difficulty: Difficulty,
): Promise<JudgeResult> {
  const npcContext = npcDialogue.map(d => {
    const npc = npcs.find(n => n.id === d.npcId);
    return `- ${npc?.name || d.npcId}说："${d.content}"`;
  }).join('\n');

  const prompt = `你是"Fake"游戏的评审。这是一个关于"语言即身份"的社会模拟器——玩家在身份全盲的群聊中，
  用语言让自己被接纳为"自己人"。你不是在评判玩家说得对不对，而是在评判：这一轮之后，NPC会更觉得玩家像圈内人，还是更不像？
  你不是打分机器，你是群里的隐形观察者。你的评价像弹幕，不像评语。可以调侃、讽刺、欣赏、惋惜，但禁止用“重复”“未回应”“缺乏”“不足”这类打分腔词汇。
  玩家看到你的评价应该觉得“被戳中了”，不是“被打了分”。

当前第${round}轮，当前暴露指数${currentSuspicion}%，难度${difficulty}

【NPC发言】
${npcContext}

【玩家历史发言】
${playerHistory || '无'}

【玩家本轮发言】
${playerMsg}

## 场景感知（先判断当前群聊在干什么）
本轮群聊的场景特征（选最接近的）：
- 学术讨论：NPC在认真探讨某个概念、理论或方法
- 情感交流：NPC在分享感受、经历或人际关系
- 日常吹水：NPC在闲聊、接梗、跑题
- 争论辩论：NPC在互相质疑、站队、对抗

## 评分维度（每项0-10，越高越像外人，越要涨怀疑度）

### 1. 圈内感（0-10）
玩家的发言像这个圈子的人吗？
- 用对了这个圈子的话语方式（学术群用术语、情感群用感受语言、吹水群用梗）
- 节奏和长度和其他人同步（别人都短他过长=怪，别人都在认真他突然玩梗=怪）
- 0=完全像圈内人 10=明显是外人

### 2. 身份自洽（0-10）
玩家构建的临时身份前后一致吗？
- 不要求事实真实，但要求语言上不自相矛盾
- 如果玩家修正了自己之前的说法，且修正方式自然（"我之前说得不准确，更准确的是……"），不扣分
- 0=前后自洽 10=明显穿帮

### 3. 存在感（0-10）
玩家这轮发言对讨论有贡献吗？
- 推动了讨论、提供了新角度、引发了NPC回应 → 低分（好的存在感）
- 说了等于没说、纯附和、机械重复别人 → 中分（无贡献但不暴露）
- 完全无视上下文、自说自话、破坏讨论节奏 → 高分（差的存在感）
- 0=有实质贡献 10=破坏讨论或完全透明人

## 加减分项：局势应对（-8~+5）
综合评估玩家在本轮互动中的表现：

### ➤ NPC犯错时，玩家的应对（重点加分项）
本轮如果某个NPC出现了以下情况，且玩家做出了合适的回应：
- NPC前后自相矛盾 → 玩家指出矛盾（-3~-5）
- NPC用错了术语或搞混了概念 → 玩家纠正（-2~-4）
- NPC的观点有明显逻辑漏洞 → 玩家拆穿（-2~-4）
- NPC在回避问题 → 玩家追问不让逃（-1~-3）
- NPC试图转移话题 → 玩家拉回来（-1~-2）
注意：只有指出得精准、语气自然才加分。如果玩家指出得生硬、过度纠缠、或自己也说错了，不加分甚至扣分。

### ➤ NPC犯错时，玩家错过机会（扣分项）
本轮NPC有明显错误，但玩家：
- 完全没注意到（+1~+2）→ 像外行，听不出问题
- 注意到了但不敢说，反而附和（+2~+3）→ 像心虚的外行

### ➤ 其他加分项
- 提出NPC没想到的角度（-2~-3）
- 一句话同时回应多个NPC（-1~-2）
- 主动把问题抛回给NPC（-1~-3）
- 对讨论本身做出精准的元观察，如"我们一直在绕圈子"（-2~-4）

### ➤ 其他扣分项
- NPC明显在帮玩家圆场或给台阶，玩家没接住（+1~+3）
- 玩家指出NPC错误时用错了方式——太冲、太生硬、不像群聊语气（+1~+2）
- 玩家指出NPC错误时自己也说错了——暴露了自己更外行（+3~+5）

注意：系统会根据以上分数加权计算暴露指数增量。你只需要给出准确的主观评分。

只返回JSON：
{
  "feedback": "≤20字，指出玩家这轮的关键表现（更像圈内人还是更不像，不要一味指责玩家重复或者逃避，要中立）",
  "surrender": false,
  "breakdown": {
    "belonging": 0-10,
    "consistency": 0-10,
    "presence": 0-10,
    "bonus": -8~+5
  },
  "sceneType": "当前场景类型"
}`;

  const text = await callAI(prompt, 'json', 'deepseek-v4-flash');
  const cleaned = text.replace(/```json|```/g, "").trim();
  try { return JSON.parse(cleaned); } catch {
    const retry = await callAI(prompt + "\n\nFAILED JSON. RETURN ONLY VALID JSON.", 'json');
    return JSON.parse(retry.replace(/```json|```/g, "").trim());
  }
}

// ── 深度复盘报告（含称号 + 锐评 + 死亡原因）──
export async function generateGameRecap(
  field: string, topic: string, rounds: number,
  finalSuspicion: number, messages: Message[], npcs: NPCPersonality[],
  judgeHistory: JudgeEntry[]
): Promise<string> {
  try {
    const historyText = messages.slice(-12).map((m: any) => `[${m.author}] ${m.content}`).join("\n");
    const npcProfiles = npcs.map(n => `- ${n.name}（${n.title}）：${n.trait}`).join("\n");
    const judgeLog = judgeHistory.map(j => `第${j.round}轮 | 变动:${j.suspicionChange} | 点评:${j.feedback}`).join("\n");
    const verdict = finalSuspicion >= 100 ? '被识破' : '成功潜伏';

    const prompt = `你是行为侧写分析师，写一份极简复盘报告。每句话都必须有信息量，没有废话。⚠️ 禁用所有markdown标记：不使用**、##、---等任何格式化符号。只输出纯文本。

## 原始数据
话题：${topic} | 领域：${field}
存活：${rounds} 轮 | 最终怀疑度：${finalSuspicion}% | 结果：${verdict}

## 每轮评分记录
${judgeLog}

## 完整对话记录
${historyText}

## 输出要求（每部分只输出内容本身，不要任何装饰符号）

🎭 身份构造模式
一句话概括玩家的核心策略，附1句玩家原文作为证据。不使用引号以外的装饰。

⚠️ 身份崩解报告（如果被识破）
一句话说明崩解原因。胜利则写"你成功活过了流亡。没有一个人拆穿你的身份构造。"

🤖 AI锐评
一句毒舌点评，20字以内。只说内容本身，不用引号。

🏅 称号系统
「称号名」+ 一句话解释原因。称号参考：流沙行者、面具商人、身份噬菌体、语言模仿者、临时躯壳、影子叙述者、半瓶水战神、降维打击惯犯

语气：冷峻带黑色幽默。用词精准。不要任何markdown符号。`;

    const text = await callAI(prompt, 'text');
    return text || `在 ${field} 存活 ${rounds} 轮，最终怀疑度 ${finalSuspicion}%。`;
  } catch {
    return `在 ${field} 存活 ${rounds} 轮，最终怀疑度 ${finalSuspicion}%。`;
  }
}
