export type Bindings = CloudflareBindings & {
  GEMINI_API_KEY: string;
  ADMIN_TOKEN: string;
  CF_AIG_TOKEN?: string;
  /** "1" in local dev: vectors live in the local D1 table local_vectors (Vectorize has no local mode). */
  LOCAL_VECTORS?: string;
  /** Trusted-site web search for Ask (optional). */
  TAVILY_API_KEY?: string;
};

export type AppEnv = { Bindings: Bindings };
