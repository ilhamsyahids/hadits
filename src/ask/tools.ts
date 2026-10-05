import { tool, type UIMessageStreamWriter } from 'ai';
import { z } from 'zod';
import { family, grades, type Lang, present, reference, resolveKey, unitsByKeys } from '../corpus/units';
import type { Bindings } from '../env';
import { norm, stems } from '../lib/arabic';
import { latinHits, rrf, stemHits, trigramHits, vectorHits, type Hit } from '../search/retrieve';
import { parseCitations } from '../search/refparse';
import { domainsFor } from './sites';

// Ask's tools. Each returns compact items whose `id` is what the answer cites; every returned id is recorded in
// `seen`, and the page hides citations to anything else. A `data-progress` part tells the page what is running.

export type Seen = Set<string>;
const WEB_BUDGET = 3; // Tavily credits per answer

const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : null);
const settle = (p: Promise<Hit[]>) => p.catch(() => [] as Hit[]);

export function makeTools(ctx: { env: Bindings; writer: UIMessageStreamWriter; seen: Seen; lang: Lang; lectureId?: string | null }) {
  const { env, writer, seen, lang } = ctx;
  const progress = (id: string, label: string, kind: 'search' | 'read' | 'web') => writer.write({ type: 'data-progress', id, data: { label, kind } });
  let webCalls = 0;

  const search_dalil = tool({
    description: 'Search the Quran and hadith corpus. keyword: exact Arabic wording (FTS). semantic: meaning in any language (vectors).',
    inputSchema: z.object({
      query: z.string().describe('Arabic wording for keyword mode, e.g. "إنما الأعمال بالنيات"; any language for semantic mode'),
      mode: z.enum(['keyword', 'semantic']),
      kind: z.enum(['quran', 'hadith', 'all']).default('all'),
      label: z.string().describe('Short progress label shown to the user, in their language'),
    }),
    execute: async ({ query, mode, kind, label }, { toolCallId }) => {
      progress(toolCallId, label, 'search');
      const k = kind === 'all' ? undefined : kind;
      const lists: Record<string, Hit[]> =
        mode === 'keyword'
          ? { stem: await settle(stemHits(env, query, k, 20)), tri: await settle(trigramHits(env, query, k, 20)), latin: await settle(latinHits(env, query, k, 20)) }
          : { vector: (await vectorHits(env, [query], 'search result', k, 20).catch(() => [[]]))[0] ?? [], latin: await settle(latinHits(env, query, k, 20)) };
      const top = rrf(lists).slice(0, 8);
      const rows = await unitsByKeys(env.CORPUS, top.map((t) => t.key));
      return top.flatMap((t) => {
        const r = rows.get(t.key);
        if (!r) return [];
        seen.add(r.key);
        return [{ id: r.key, kind: r.kind, reference: reference(r, lang), ar: clip(r.ar_matn, 320), en: clip(r.en_text, 320), grade_status: r.grade_status }];
      });
    },
  });

  const expand_dalil = tool({
    description: 'Full text of one result: grades by grader, other wordings of the same hadith, chapter.',
    inputSchema: z.object({ id: z.string().describe('An id returned by search_dalil, e.g. "bukhari:1" or "quran:2:255"'), label: z.string() }),
    execute: async ({ id, label }, { toolCallId }) => {
      progress(toolCallId, label, 'read');
      const row = await resolveKey(env.CORPUS, id);
      if (!row) return { error: `no unit ${id}` };
      seen.add(row.key);
      const fam = row.kind === 'hadith' ? await family(env.CORPUS, row, 8) : [];
      fam.forEach((f) => seen.add(f.key));
      const p = present(row, { full: true, lang });
      return {
        id: row.key, reference: p.reference, chapter: p.chapter, ar: clip(row.ar_matn, 1500), en: clip(row.en_text, 1500), chain_en: row.en_isnad ?? null,
        grade_status: row.grade_status, grades: grades(row).map((g) => ({ grader: g.grader, grade: g.grade, conflict: g.conflict })),
        other_wordings: fam.map((f) => ({ id: f.key, reference: `${f.collection_name} ${f.number}`, grade_status: f.grade_status })),
      };
    },
  });

  const search_lecture = tool({
    description:
      'Search the text of this lecture or article. Returns passages with where they are: a time (m:ss) or a paragraph (¶ n), ' +
      'and the ayat and hadith each passage cites (ids you may use in tags and citations).',
    inputSchema: z.object({ query: z.string().describe('Words to look for, in the lecture language or Arabic'), label: z.string() }),
    execute: async ({ query, label }, { toolCallId }) => {
      progress(toolCallId, label, 'search');
      type Lecture = { timing?: string; segments: { start: number; end: number; text: string }[] };
      const lecture = ctx.lectureId ? await env.CACHE.get<Lecture>(`lecture:${ctx.lectureId}`, 'json') : null;
      if (!lecture) return { error: 'no lecture in this conversation' };
      const words = (s: string) => new Set([...s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2), ...stems(s).split(' ').filter((w) => w.length > 2)]);
      const q = words(query);
      const scored = lecture.segments
        .map((s, i) => {
          const w = words(`${s.text} ${norm(s.text)}`);
          let n = 0;
          for (const t of q) if (w.has(t)) n++;
          return { i, n };
        })
        .filter((x) => x.n > 0)
        .sort((a, b) => b.n - a.n)
        .slice(0, 5);
      // What each passage cites ("[البقرة:203]", "HR Muslim 1631"), checked against the corpus: the speaker's own
      // references become sources the answer may show, like search results.
      const citedKeys = scored.map(({ i }) =>
        parseCitations(lecture.segments[i].text).flatMap((c) =>
          c.kind === 'quran'
            ? Array.from({ length: Math.min(3, c.to - c.from + 1) }, (_, k) => `quran:${c.surah}:${c.from + k}`)
            : c.number ? [`${c.collection}:${c.number}`] : [],
        ),
      );
      const rows = await unitsByKeys(env.CORPUS, citedKeys.flat());
      return scored.map(({ i }, k) => {
        const id = `lecture:${ctx.lectureId}#${i}`;
        seen.add(id);
        const s = lecture.segments[i];
        const where = lecture.timing === 'audio' ? `${Math.floor(s.start / 60)}:${String(Math.floor(s.start % 60)).padStart(2, '0')}` : `¶ ${i + 1}`;
        const cites = citedKeys[k].flatMap((key) => {
          const row = rows.get(key);
          if (!row) return [];
          seen.add(key);
          return [{ id: key, reference: reference(row, ctx.lang) }];
        });
        return { id, where, text: clip(s.text, 900), ...(cites.length ? { cites } : {}) };
      });
    },
  });

  const web_search_trusted = tool({
    description:
      'Search a fixed list of trusted Islamic websites for explanation or contemporary questions. Not for hadith text or grades. ' +
      'language picks the sites written in that language (ar, en, id); all searches every site.',
    inputSchema: z.object({ query: z.string(), language: z.enum(['ar', 'en', 'id', 'all']).default('all'), label: z.string() }),
    execute: async ({ query, language, label }, { toolCallId }) => {
      if (!env.TAVILY_API_KEY) return { error: 'web search is not configured' };
      if (webCalls >= WEB_BUDGET) return { error: 'web search budget for this answer is used up' };
      webCalls++;
      progress(toolCallId, label, 'web');
      const domains = domainsFor(language);
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.TAVILY_API_KEY}` },
        body: JSON.stringify({ query, search_depth: 'basic', max_results: 5, include_domains: domains }),
      });
      if (!res.ok) return { error: `web search failed (${res.status})` };
      const data = (await res.json()) as { results: { url: string; title: string; content: string }[] };
      return Promise.all(
        data.results.map(async (r) => {
          const h = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(r.url));
          const id = `web:${[...new Uint8Array(h)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
          seen.add(id);
          return { id, url: r.url, site: new URL(r.url).hostname.replace(/^www\./, ''), title: r.title, snippet: clip(r.content, 600) };
        }),
      );
    },
  });

  return { search_dalil, expand_dalil, web_search_trusted, ...(ctx.lectureId ? { search_lecture } : {}) };
}
