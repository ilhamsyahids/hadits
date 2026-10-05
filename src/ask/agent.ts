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
const MAX_TURNS = 30;

export class AskAgent extends AIChatAgent<Bindings> {
  maxPersistedMessages = 80;

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const env = this.env;
    const body = (options?.body ?? {}) as { lang?: string; lectureId?: string };
    const lang = asLang(body.lang);
    const lectureId = typeof body.lectureId === 'string' ? body.lectureId : null;
    const lecture = lectureId ? await env.CACHE.get<{ title: string }>(`lecture:${lectureId}`, 'json') : null;

    const stream = createUIMessageStream<AskMessage>({
      originalMessages: this.messages as AskMessage[],
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
        const system = instructions({ lang, lecture: lecture ? { title: lecture.title } : null });
        const history = await convertToModelMessages(this.messages);
        const result = streamText({
          model: google(env.LLM_MODEL),
          instructions: system,
          messages: history,
          tools: makeTools({ env, writer, seen, lang, lectureId: lecture ? lectureId : null }),
          stopWhen: isStepCount(MAX_STEPS),
          // Last step: no tools at all. With tools declared but disabled, Gemini can return an empty text block.
          prepareStep: ({ stepNumber }) =>
            stepNumber === 0 ? { toolChoice: 'required' as const } : stepNumber === MAX_STEPS - 1 ? { toolChoice: 'none' as const, activeTools: [] } : {},
          providerOptions: { google: { thinkingConfig: { thinkingLevel: 'low' } } },
          abortSignal: options?.abortSignal,
        });
        writer.merge(toUIMessageStream({ stream: result.stream, sendFinish: false }));
        if (!(await result.text).trim()) {
          // The searches ran but no answer was written: one more step, without tools, from what they returned.
          const answer = streamText({
            model: google(env.LLM_MODEL),
            instructions: `${system}\n\nThe searches are done. Write the answer now from the tool results above, following every rule; do not call tools.`,
            messages: [...history, ...(await result.responseMessages)],
            providerOptions: { google: { thinkingConfig: { thinkingLevel: 'low' } } },
            abortSignal: options?.abortSignal,
          });
          writer.merge(toUIMessageStream({ stream: answer.stream, sendStart: false, sendFinish: false }));
          await answer.text;
        }
        // Everything the tools returned this turn: the page hides citations and scripture tags outside this set.
        writer.write({ type: 'data-citations', data: { ids: [...seen] } });
        writer.write({ type: 'finish' });
      },
    });
    return createUIMessageStreamResponse({ stream });
  }
}
