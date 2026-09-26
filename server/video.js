// 神スレ → 動画台本。ANTHROPIC_API_KEY 等の認証があれば Claude で脚本化、無ければルールベース。
import Anthropic from '@anthropic-ai/sdk';
import { buildClaudeRequest, parseClaudeResponse, ruleBasedFromPosts, FALLBACK_BETA, DEFAULT_MODEL } from '../public/lib/script.js';

const MODEL = process.env.CLAUDE_MODEL || DEFAULT_MODEL;

let client = null;
function getClient() {
  if (client !== null) return client;
  const hasCred = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  client = hasCred ? new Anthropic() : false;
  return client;
}

export async function generateScript(title, posts) {
  const c = getClient();
  if (c) {
    try {
      const res = await c.beta.messages.create({ ...buildClaudeRequest(title, posts, MODEL), betas: [FALLBACK_BETA] });
      return parseClaudeResponse(res);
    } catch (e) {
      console.warn(`[video] Claude 生成失敗、ルールベースにフォールバック: ${e.message}`);
    }
  }
  return ruleBasedFromPosts(title, posts);
}
