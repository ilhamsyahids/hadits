import type { Doc } from './doc';
import { quizKey } from './quiz';
import { decisionsKey, reportKey } from './report';
import { translationKey } from './translate';

/** Removes a submitted text and everything built from it (reports, translations, quizzes, terms). */
export async function forgetDocument(cache: KVNamespace, doc: Doc): Promise<void> {
  const id = doc.id;
  await Promise.all([
    cache.delete(`lecture:${id}`),
    ...(doc.submitted ? [cache.delete(`doc:hash:${doc.submitted.text_hash}`)] : []),
    cache.delete(decisionsKey(id)),
    ...(['en', 'ar'] as const).flatMap((l) => [reportKey(id, l), quizKey(id, l), `terms:v1:${id}:${l}`].map((k) => cache.delete(k))),
    ...(['en', 'ar', 'id'] as const).map((l) => cache.delete(translationKey(id, l))),
  ]);
}
