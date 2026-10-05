// The reader's own texts (POST /v1/documents), remembered in this browser with the token that deletes them.

export type MyDoc = { id: string; title: string; token: string | null; expires: number | null; created: number };
const KEY = 'docs:mine';

export function myDocs(): MyDoc[] {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? '[]') as MyDoc[]).filter((d) => !d.expires || d.expires > Date.now());
  } catch {
    return [];
  }
}

function save(docs: MyDoc[]) {
  try { localStorage.setItem(KEY, JSON.stringify(docs.slice(0, 50))); } catch { /* storage blocked: the link still works */ }
}

export type SubmitError = 'too_short' | 'too_long' | 'rate_limited' | 'failed';

export async function submitText(text: string, opts: { title?: string; filename?: string } = {}): Promise<{ id: string } | { error: SubmitError }> {
  try {
    const res = await fetch('/v1/documents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, ...opts }) });
    const body = (await res.json().catch(() => ({}))) as { id?: string; token?: string | null; title?: string; expires?: number; error?: string };
    if (!res.ok || !body.id) return { error: (['too_short', 'too_long', 'rate_limited'].includes(body.error ?? '') ? body.error : 'failed') as SubmitError };
    const docs = myDocs().filter((d) => d.id !== body.id);
    const known = myDocs().find((d) => d.id === body.id);
    docs.unshift({ id: body.id, title: body.title ?? known?.title ?? opts.title ?? text.slice(0, 80), token: body.token ?? known?.token ?? null, expires: body.expires ?? known?.expires ?? null, created: Date.now() });
    save(docs);
    return { id: body.id };
  } catch {
    return { error: 'failed' };
  }
}

export async function deleteText(id: string): Promise<boolean> {
  const doc = myDocs().find((d) => d.id === id);
  if (!doc?.token) return false;
  const res = await fetch(`/v1/documents/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${doc.token}` } }).catch(() => null);
  if (!res || (!res.ok && res.status !== 404)) return false;
  save(myDocs().filter((d) => d.id !== id));
  return true;
}

/** Long or multi-paragraph input is a whole lecture or article, not one quote. */
export const looksLikeDocument = (text: string) => text.length > 1500 || (text.length > 400 && text.trim().split(/\n\s*\n/).length >= 3);
