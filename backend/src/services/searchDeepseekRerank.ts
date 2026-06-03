/**
 * searchDeepseekRerank.ts — Reranker opcional con DeepSeek
 *
 * REGLAS:
 *  - Solo reordena candidatos ya encontrados por el pipeline local.
 *  - NO inventa canciones ni URLs.
 *  - Si falla, el pipeline usa el ranking local sin cambios.
 *  - Desactivado por defecto (DEEPSEEK_SEARCH_RERANK_ENABLED=false).
 *
 * Variables de entorno:
 *   DEEPSEEK_SEARCH_RERANK_ENABLED    = false (default)
 *   DEEPSEEK_SEARCH_RERANK_TIMEOUT_MS = 3000  (default)
 *   DEEPSEEK_SEARCH_RERANK_MAX_ITEMS  = 20    (default)
 */

import axios from 'axios';
import { getDeepSeekConfig } from './deepseekRecommendations';

const getEnvBool = (raw: string | undefined) => {
  if (!raw) return false;
  return raw === 'true' || raw === '1' || raw === 'yes';
};

export const isSearchRerankEnabled = (): boolean => {
  if (!getEnvBool(process.env.DEEPSEEK_SEARCH_RERANK_ENABLED)) return false;
  const cfg = getDeepSeekConfig();
  return !!cfg.apiKey;
};

type RerankItem = {
  _rerankId: string;
  title: string;
  artist: string;
  duration: number | null;
  source: string | null;
};

/**
 * Dado un query del usuario y una lista de candidatos ya rankeados localmente,
 * pide a DeepSeek que reordene los candidatos según relevancia.
 *
 * Devuelve la lista reordenada. Si falla, devuelve los items originales.
 */
export const rerankWithDeepSeek = async <T extends object>(
  rawQuery: string,
  items: Array<T & { title?: string | null; artist?: string | null; duration_seconds?: number | null; source?: string | null }>
): Promise<Array<T>> => {
  if (!isSearchRerankEnabled() || items.length === 0) return items;

  const maxItems = Math.min(
    items.length,
    Number.parseInt(process.env.DEEPSEEK_SEARCH_RERANK_MAX_ITEMS || '20', 10) || 20
  );
  const timeoutMs = Math.min(
    Number.parseInt(process.env.DEEPSEEK_SEARCH_RERANK_TIMEOUT_MS || '3000', 10) || 3000,
    8000
  );

  const toRank = items.slice(0, maxItems);
  const rest = items.slice(maxItems);

  // Asignar IDs temporales para que DeepSeek los devuelva en orden
  const mapped: RerankItem[] = toRank.map((item, i) => ({
    _rerankId: String(i),
    title: String((item as any).title || '').trim().slice(0, 80),
    artist: String((item as any).artist || (item as any).uploader || '').trim().slice(0, 60),
    duration: Number((item as any).duration_seconds || (item as any).duration || 0) || null,
    source: String((item as any).source || ''),
  }));

  const cfg = getDeepSeekConfig();
  const model = String(process.env.DEEPSEEK_SEARCH_RERANK_MODEL || cfg.model || 'deepseek-chat');

  const systemPrompt = [
    'Eres un asistente de búsqueda musical.',
    'Se te dará una lista de candidatos de canciones y una búsqueda del usuario.',
    'Tu tarea: reordenar los candidatos por relevancia con la búsqueda.',
    'REGLAS ESTRICTAS:',
    '- Devuelve SOLO JSON válido con la forma {"order": ["0","1","2",...]}',
    '- Usa solo los _rerankId que recibiste, sin inventar nuevos.',
    '- No inventes canciones ni cambies los datos.',
    '- Si no puedes decidir, devuelve el orden original.',
    '- Penaliza: karaoke, instrumental, slowed, sped up, reverb, cover — a menos que la búsqueda lo pida.',
    '- Prioriza: versión official audio/video, artista coincide con búsqueda, título coincide.',
  ].join('\n');

  const userPrompt = [
    `Búsqueda: ${JSON.stringify(rawQuery)}`,
    '',
    'Candidatos:',
    JSON.stringify(mapped, null, 2),
    '',
    'Devuelve el JSON con el orden óptimo de _rerankId.',
  ].join('\n');

  try {
    const res = await axios.post(
      `${cfg.baseUrl}/chat/completions`,
      {
        model,
        temperature: 0.0,
        max_tokens: 200,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      },
      {
        timeout: timeoutMs,
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const content = String(res?.data?.choices?.[0]?.message?.content || '').trim();
    if (!content) return items;

    let parsed: any = null;
    try {
      parsed = JSON.parse(content);
    } catch {
      const start = content.indexOf('{');
      const end = content.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          parsed = JSON.parse(content.slice(start, end + 1));
        } catch {}
      }
    }

    const order = Array.isArray(parsed?.order) ? parsed.order : null;
    if (!order || order.length === 0) return items;

    // Reconstruir en el nuevo orden
    const idToItem = new Map<string, T>(toRank.map((item, i) => [String(i), item]));
    const reranked: T[] = [];
    const usedIds = new Set<string>();

    for (const id of order) {
      const item = idToItem.get(String(id));
      if (item && !usedIds.has(String(id))) {
        reranked.push(item);
        usedIds.add(String(id));
      }
    }

    // Añadir los que no vinieron en el orden (por si DeepSeek omitió alguno)
    for (const [id, item] of idToItem.entries()) {
      if (!usedIds.has(id)) reranked.push(item);
    }

    console.log('[search/rerank] deepseek reranked', {
      query: rawQuery,
      before: toRank.length,
      after: reranked.length,
    });

    return [...reranked, ...rest];
  } catch (error: any) {
    console.warn('[search/rerank] deepseek failed, using local ranking', {
      error: error?.message,
      query: rawQuery,
    });
    return items;
  }
};
