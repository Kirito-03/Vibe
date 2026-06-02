import axios from 'axios';
import { getDeepSeekConfig } from './deepseekRecommendations';

const getEnvBool = (raw: string | undefined) => {
  if (!raw) return false;
  return raw === 'true' || raw === '1' || raw === 'yes';
};

const sanitizeQuery = (raw: unknown) => {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return '';
  if (s.length > 120) return s.slice(0, 120).trim();
  if (/https?:\/\//i.test(s) || /\bwww\./i.test(s) || /\byoutube\.com\b/i.test(s)) return '';
  return s.replace(/\s+/g, ' ').trim();
};

const dedupe = (queries: unknown[], limit: number) => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const q of queries) {
    const cleaned = sanitizeQuery(q);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= limit) break;
  }
  return out;
};

export const isAiSearchAssistEnabled = () => {
  const enabled = getEnvBool(process.env.AI_SEARCH_ASSIST_ENABLED);
  const cfg = getDeepSeekConfig();
  return enabled && !!cfg.apiKey;
};

export const getSearchQueryAlternatives = async (inputQuery: string) => {
  if (!isAiSearchAssistEnabled()) return null;
  const cfg = getDeepSeekConfig();
  const q = sanitizeQuery(inputQuery);
  if (!q) return null;

  const timeoutMsRaw = Number.parseInt(process.env.AI_SEARCH_ASSIST_TIMEOUT_MS || '3000', 10);
  const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : 3000;
  const model = String(process.env.AI_SEARCH_ASSIST_MODEL || cfg.model || 'deepseek-chat').trim() || 'deepseek-chat';

  const payload = {
    model,
    temperature: 0.2,
    max_tokens: 120,
    messages: [
      {
        role: 'system',
        content:
          'Eres un asistente de búsqueda musical. Devuelve SOLO JSON válido con la forma {"queries":[...]} y máximo 3 queries. No incluyas URLs.',
      },
      {
        role: 'user',
        content: `Input: ${JSON.stringify(q)}\nDevuelve queries alternativas para corregir o completar la búsqueda, manteniendo la intención.`,
      },
    ],
  };

  try {
    const res = await axios.post(
      `${cfg.baseUrl}/chat/completions`,
      payload,
      {
        timeout: timeoutMs,
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );
    const content = String(res?.data?.choices?.[0]?.message?.content || '').trim();
    if (!content) return null;
    let parsed: any = null;
    try {
      parsed = JSON.parse(content);
    } catch {
      const start = content.indexOf('{');
      const end = content.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          parsed = JSON.parse(content.slice(start, end + 1));
        } catch {
          parsed = null;
        }
      }
    }
    const arr = Array.isArray(parsed?.queries) ? parsed.queries : null;
    if (!arr) return null;
    const queries = dedupe(arr, 3);
    return queries.length > 0 ? queries : null;
  } catch {
    return null;
  }
};

