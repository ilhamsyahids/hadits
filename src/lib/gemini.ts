import type { Bindings } from '../env';

// Gemini over REST. One port, two transports: AI Gateway when CF_AIG_TOKEN is set (logs, spend limits),
// otherwise Google directly. Embeddings must use the same document/query format as tools/embed_batch.py.

const GOOGLE = 'https://generativelanguage.googleapis.com/v1beta';

function endpoint(env: Bindings, path: string): { url: string; headers: Record<string, string> } {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY };
  if (env.CF_AIG_TOKEN) {
    headers['cf-aig-authorization'] = `Bearer ${env.CF_AIG_TOKEN}`;
    const base = `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/google-ai-studio/v1beta`;
    return { url: `${base}/${path}`, headers };
  }
  return { url: `${GOOGLE}/${path}`, headers };
}

async function call<T>(env: Bindings, path: string, body: unknown): Promise<T> {
  const payload = JSON.stringify(body);
  const { url, headers } = endpoint(env, path);
  let res = await fetch(url, { method: 'POST', headers, body: payload });
  // Gateway refused (bad token, outage): the same request straight to Google, so a gateway problem never breaks verify.
  if (env.CF_AIG_TOKEN && (res.status === 401 || res.status === 403 || res.status >= 500)) {
    console.warn(`ai gateway ${res.status}; calling Gemini directly`);
    res = await fetch(`${GOOGLE}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY }, body: payload });
  }
  if (!res.ok) throw new Error(`gemini ${path.split(':')[1]} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
}

export type EmbedTask = 'search result' | 'fact checking';

export const queryText = (text: string, task: EmbedTask = 'search result') => `task: ${task} | query: ${text}`;

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/** Embed query strings (already formatted with queryText). Cached in KV by hash; one batch call for misses. */
export async function embedQueries(env: Bindings, texts: string[]): Promise<number[][]> {
  const keys = await Promise.all(texts.map((t) => sha256(`${env.EMBED_MODEL}:${env.EMBED_DIM}:${t}`).then((h) => `emb:${h}`)));
  const cached = await Promise.all(keys.map((k) => env.CACHE.get<number[]>(k, 'json')));
  const missing = texts.map((t, i) => (cached[i] ? -1 : i)).filter((i) => i >= 0);
  if (missing.length) {
    const model = `models/${env.EMBED_MODEL}`;
    const res = await call<{ embeddings: { values: number[] }[] }>(env, `${model}:batchEmbedContents`, {
      requests: missing.map((i) => ({ model, content: { parts: [{ text: texts[i] }] }, outputDimensionality: Number(env.EMBED_DIM) })),
    });
    await Promise.all(
      missing.map((i, j) => {
        cached[i] = res.embeddings[j].values;
        return env.CACHE.put(keys[i], JSON.stringify(cached[i]), { expirationTtl: 60 * 60 * 24 * 30 });
      }),
    );
  }
  return cached as number[][];
}

type GenerateResponse = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
};

export type Usage = { input: number; output: number };

/** One structured-output call. `schema` is a Gemini responseSchema (OpenAPI subset). */
export async function generateJSON<T>(
  env: Bindings,
  opts: { model?: string; system: string; prompt: string; schema: unknown; thinking?: 'minimal' | 'low' | 'medium' | 'high' },
): Promise<{ data: T; usage: Usage }> {
  const model = opts.model ?? env.LLM_MODEL;
  const res = await call<GenerateResponse>(env, `models/${model}:generateContent`, {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: opts.schema,
      temperature: 0,
      ...(opts.thinking ? { thinkingConfig: { thinkingLevel: opts.thinking } } : {}),
    },
  });
  const text = res.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? '').join('') ?? '';
  const u = res.usageMetadata ?? {};
  return {
    data: JSON.parse(text) as T,
    usage: { input: u.promptTokenCount ?? 0, output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) },
  };
}
