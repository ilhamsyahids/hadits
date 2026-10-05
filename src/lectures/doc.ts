// A lecture or article as stored in KV (lecture:{id}): the sample ones (tools/demo_lectures.py) and the ones
// readers submit (POST /v1/documents). Positions are real times only for timed transcripts (subtitles);
// everything else is located by paragraph.

export type DocSegment = { start: number; end: number; text: string; section?: string | null; speaker?: string | null };
export type DocSource = { name: string; url?: string | null; license?: string | null; license_url?: string | null; note?: string | null };
export type Doc = {
  id: string;
  title: string;
  lang: string;
  kind?: 'lecture' | 'article' | 'text';
  timing?: 'audio' | 'position';
  duration: number;
  source?: DocSource | null;
  // Set on a reader's submission: when it expires, and the hash of the token that may delete it.
  submitted?: { created: number; expires: number; token_hash: string; text_hash: string } | null;
  segments: DocSegment[];
};
export type DocIndexItem = { id: string; title: string; lang: string; kind?: Doc['kind']; timing?: Doc['timing']; duration: number; segments: number };

/** Older samples carried estimated seconds; only subtitles have real times. */
export const timingOf = (d: Pick<Doc, 'timing'>) => (d.timing === 'audio' ? 'audio' : 'position');
