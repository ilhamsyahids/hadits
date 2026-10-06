import { createGoogle } from '@ai-sdk/google';
import { AIChatAgent, type OnChatMessageOptions } from '@cloudflare/ai-chat';
import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, isStepCount, streamText, toUIMessageStream, type UIMessage } from 'ai';
import { asLang } from '../corpus/units';
import type { Bindings } from '../env';
import { instructions } from './prompt';
import { makeTools, type Seen } from './tools';

// Ask: one Durable Object per conversation (history in its SQLite, streams survive a closed tab).
// Turn shape: a forced parallel search round, up to two steps to expand or search again, then an answer-only step.

export type AskData = {
  progress: { label: string; kind: 'search' | 'read' | 'web' };
  citations: { ids: string[] };
};
export type AskMessage = UIMessage<unknown, AskData>;

const MAX_STEPS = 4;
const EMPTY_ANSWER = {
  en: 'The sources were found (listed below), but no answer was written. Please ask again or rephrase the question.',
  ar: 'وُجدت المصادر (مذكورة أدناه)، لكن لم تُكتب إجابة. أعد السؤال أو صِغه بطريقة أخرى.',
  id: 'Sumber ditemukan (tercantum di bawah), tetapi jawaban tidak tertulis. Silakan tanya lagi atau ubah pertanyaannya.',
} as const;
// Provider errors after streaming started (overload, a dropped connection) are retried before the reader sees them.
const STREAM_RETRIES = 2;

/** What the reader (and the Ask eval) sees for an error that survived the retries: its kind, never a stack. */
const describe = (e: unknown) => {
  console.error('ask stream error', e);
  const m = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return `The answer stopped: ${m.slice(0, 160)}`;
};
const MAX_TURNS = 30;

/** The reader's last question, as text. */
const lastQuestion = (messages: UIMessage[]) =>
  [...messages].reverse().find((m) => m.role === 'user')?.parts.map((p) => (p.type === 'text' ? p.text : '')).join(' ') ?? '';

/** What the tools returned this turn, flattened to text for a writing step that has no tools. */
function toolResults(messages: { role: string; content: unknown }[]) {
  const out: string[] = [];
  for (const m of messages) {
    if (m.role !== 'tool' || !Array.isArray(m.content)) continue;
    for (const part of m.content as { type: string; toolName?: string; output?: { value?: unknown } }[]) {
      if (part.type === 'tool-result') out.push(`${part.toolName}: ${JSON.stringify(part.output?.value ?? part.output)}`);
    }
  }
  return out.join('\n').slice(0, 40_000);
}

export class AskAgent extends AIChatAgent<Bindings> {
  maxPersistedMessages = 80;

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const env = this.env;
    const body = (options?.body ?? {}) as { lang?: string; lectureId?: string; level?: string };
    const level = body.level === 'new' ? ('new' as const) : ('student' as const);
    const lang = asLang(body.lang);
    const lectureId = typeof body.lectureId === 'string' ? body.lectureId : null;
    const lecture = lectureId ? await env.CACHE.get<{ title: string; kind?: 'lecture' | 'article' | 'text' }>(`lecture:${lectureId}`, 'json') : null;

    const stream = createUIMessageStream<AskMessage>({
      originalMessages: this.messages as AskMessage[],
      onError: describe,
      execute: async ({ writer }) => {
        if (this.messages.filter((m) => m.role === 'user').length > MAX_TURNS) {
          writer.write({ type: 'text-start', id: 'limit' });
          writer.write({ type: 'text-delta', id: 'limit', delta: 'This conversation is long enough. Please start a new one.' });
          writer.write({ type: 'text-end', id: 'limit' });
          return;
        }
        const seen: Seen = new Set();
        const google = createGoogle({
          apiKey: env.GEMINI_API_KEY,
          ...(env.CF_AIG_TOKEN
            ? {
                baseURL: `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/google-ai-studio/v1beta`,
                headers: { 'cf-aig-authorization': `Bearer ${env.CF_AIG_TOKEN}`, 'cf-aig-skip-cache': 'true' },
              }
            : {}),
        });
        const system = instructions({ lang, level, lecture: lecture ? { title: lecture.title, kind: lecture.kind ?? 'lecture' } : null });
        const history = await convertToModelMessages(this.messages);
        const result = streamText({
          model: google(env.LLM_MODEL),
          instructions: system,
          messages: history,
          tools: makeTools({ env, writer, seen, lang, lectureId: lecture ? lectureId : null }),
          stopWhen: isStepCount(MAX_STEPS),
          // Last step: tools stay declared but calling is off at the API (function calling mode NONE). Removing them
          // instead made Gemini call a tool that no longer existed (AI_NoSuchToolError) and end without text.
          prepareStep: ({ stepNumber }) => (stepNumber === 0 ? { toolChoice: 'required' as const } : stepNumber === MAX_STEPS - 1 ? { toolChoice: 'none' as const } : {}),
          providerOptions: { google: { thinkingConfig: { thinkingLevel: 'low' } } },
          streamRetries: STREAM_RETRIES,
          abortSignal: options?.abortSignal,
        });
        writer.merge(toUIMessageStream({ stream: result.stream, sendFinish: false, onError: describe }));
        if (!(await result.text).trim()) {
          // The searches ran but no answer was written: one more step, without tools, from what they returned.
          // The results go in as plain text: with tool calls in the history, Gemini keeps trying to call tools.
          const answer = streamText({
            model: google(env.LLM_MODEL),
            instructions: `${system}\n\nThe searches are done. Write the answer now from the search results below, following every rule. You have no tools.`,
            messages: [{ role: 'user', content: `Question: ${lastQuestion(this.messages)}\n\nSearch results (JSON, ids to use in tags and citations):\n${toolResults(await result.responseMessages)}` }],
            providerOptions: { google: { thinkingConfig: { thinkingLevel: 'low' } } },
            streamRetries: STREAM_RETRIES,
            abortSignal: options?.abortSignal,
          });
          writer.merge(toUIMessageStream({ stream: answer.stream, sendStart: false, sendFinish: false, onError: describe }));
          if (!(await answer.text).trim()) {
            // Still nothing: say so plainly rather than end the turn with sources and no words.
            writer.write({ type: 'text-start', id: 'empty' });
            writer.write({ type: 'text-delta', id: 'empty', delta: EMPTY_ANSWER[lang] });
            writer.write({ type: 'text-end', id: 'empty' });
          }
        }
        // Everything the tools returned this turn: the page hides citations and scripture tags outside this set.
        writer.write({ type: 'data-citations', data: { ids: [...seen] } });
        writer.write({ type: 'finish' });
      },
    });
    return createUIMessageStreamResponse({ stream });
  }
}
