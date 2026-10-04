export type Bindings = CloudflareBindings & {
  GEMINI_API_KEY: string;
  ADMIN_TOKEN: string;
  CF_AIG_TOKEN?: string;
  /** "1" in local dev: vectors live in the local D1 table local_vectors (Vectorize has no local mode). */
  LOCAL_VECTORS?: string;
};

export type AppEnv = { Bindings: Bindings };
