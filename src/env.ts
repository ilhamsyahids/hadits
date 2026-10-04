export type Bindings = CloudflareBindings & {
  GEMINI_API_KEY: string;
  ADMIN_TOKEN: string;
  CF_AIG_TOKEN?: string;
};

export type AppEnv = { Bindings: Bindings };
