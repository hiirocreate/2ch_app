// 神スレ → 動画台本(シーン列)の生成。ANTHROPIC_API_KEY 等の認証があれば Claude で脚本化、無ければルールベース。
import Anthropic from '@anthropic-ai/sdk';
import { pickHighlights } from './score.js';

export const MOODS = ['chill', 'hype', 'funny', 'sad', 'tense', 'heartwarming'];
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'mood', 'artStyle', 'scenes'],
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    mood: { type: 'string', enum: MOODS },
    artStyle: { type: 'string', description: 'English art style keywords shared by all illustrations' },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['no', 'speaker', 'text', 'image', 'emotion'],
        properties: {
          no: { type: 'integer', description: 'レス番号 (ナレーションは 0)' },
          speaker: { type: 'string', enum: ['narrator', 'op', 'anon'] },
          text: { type: 'string', description: '読み上げ・字幕用の日本語' },
          image: { type: 'string', description: 'English illustration prompt for this scene' },
          emotion: { type: 'string', enum: ['neutral', 'laugh', 'surprise', 'sad', 'angry', 'excited'] },
        },
      },
    },
  },
};

const SYSTEM = `あなたは日本のネット掲示板(2ch/5ch/おんJ/なんJ)の「神スレ」を、まとめ動画(ゆっくり解説風)の台本にする編集者です。
- 渡されたレスから流れが伝わるよう 15〜30 シーンを選び、時系列順に並べる。冒頭と最後はナレーター(narrator)で導入と締め。
- イッチ(スレ主)のレスは speaker=op、その他は anon。text は読み上げやすく整える(AA・URL・過度な記号は除去、1シーン120字以内、元の口調やネットスラングは残す)。
- 個人を特定できる情報、誹謗中傷、差別表現はぼかすか除外する。
- image はそのシーンを表す挿絵の英語プロンプト(実在人物名・ロゴ・文字は含めない)。artStyle は全シーン共通の画風。
- mood は BGM の雰囲気。`;

let client = null;
function getClient() {
  if (client !== null) return client;
  const hasCred = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  client = hasCred ? new Anthropic() : false;
  return client;
}

function formatPosts(posts, opId) {
  return posts
    .map((p) => `>>${p.no}${opId && p.id === opId ? ' [イッチ]' : ''}\n${p.body}`)
    .join('\n\n');
}

export async function generateScript(title, posts) {
  const highlights = pickHighlights(posts, 60);
  const c = getClient();
  if (c) {
    try {
      return await generateWithClaude(c, title, highlights, posts[0]?.id);
    } catch (e) {
      console.warn(`[video] Claude 生成失敗、ルールベースにフォールバック: ${e.message}`);
    }
  }
  return ruleBasedScript(title, highlights, posts[0]?.id);
}

async function generateWithClaude(c, title, highlights, opId) {
  const res = await c.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: `スレタイ: ${title}\n\n${formatPosts(highlights, opId)}` }],
  });
  if (res.stop_reason === 'refusal') throw new Error(`refusal: ${res.stop_details?.category ?? 'unknown'}`);
  if (res.stop_reason === 'max_tokens') throw new Error('max_tokens に到達');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const script = JSON.parse(text);
  return { ...script, generator: res.model, createdAt: Date.now() };
}

const clean = (s) =>
  s
    .replace(/https?:\/\/\S+/g, '')
    .replace(/(?:>>|＞＞)\d+(?:-\d+)?/g, '')
    .replace(/[─-╿▀-▟]{3,}/g, '') // 罫線系AA
    .replace(/\n{2,}/g, '\n')
    .trim();

export function ruleBasedScript(title, highlights, opId) {
  const t = title.replace(/\s*\[.*?\]\s*$/, '');
  const scenes = [
    { no: 0, speaker: 'narrator', text: `今回紹介するのはこちらのスレ。「${t}」`, image: `${t}`, emotion: 'neutral' },
  ];
  for (const p of highlights.slice(0, 28)) {
    const text = clean(p.body).slice(0, 120);
    if (!text) continue;
    const laugh = /草|ワロタ|ｗｗ|ww/.test(text);
    scenes.push({
      no: p.no,
      speaker: p.no === 1 || (opId && p.id === opId) ? 'op' : 'anon',
      text,
      image: text.slice(0, 60),
      emotion: laugh ? 'laugh' : /！|!|\?|？/.test(text) ? 'surprise' : 'neutral',
    });
  }
  scenes.push({ no: 0, speaker: 'narrator', text: 'というわけで、今回のスレはここまで。', image: t, emotion: 'neutral' });
  const laughs = scenes.filter((s) => s.emotion === 'laugh').length;
  return {
    title: t,
    summary: `「${t}」のハイライト`,
    mood: laughs > scenes.length / 4 ? 'funny' : 'chill',
    artStyle: 'anime style, soft lighting, detailed background, japanese internet culture',
    scenes,
    generator: 'rule-based',
    createdAt: Date.now(),
  };
}
