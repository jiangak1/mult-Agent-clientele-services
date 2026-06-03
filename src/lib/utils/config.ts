const env = (key: string, fallback = ""): string =>
  process.env[key] ?? fallback;

const envInt = (key: string, fallback: number): number => {
  const v = process.env[key];
  return v ? parseInt(v, 10) : fallback;
};

const envBool = (key: string, fallback = false): boolean => {
  const v = process.env[key];
  return v ? v === "true" || v === "1" : fallback;
};

export const config = {
  nodeEnv: env("NODE_ENV", "development"),
  isDev: env("NODE_ENV") !== "production",

  db: {
    url: env("DATABASE_URL", "postgresql://csp_admin:csp_secure_pwd@localhost:5432/customer_service"),
    password: env("POSTGRES_PASSWORD", "csp_secure_pwd"),
  },

  redis: {
    url: env("REDIS_URL", "redis://:csp_redis_pwd@localhost:6379"),
    password: env("REDIS_PASSWORD", "csp_redis_pwd"),
  },

  milvus: {
    address: env("MILVUS_ADDRESS", "localhost:19530"),
    dbName: env("MILVUS_DB_NAME", "customer_service"),
    collections: {
      knowledge: env("MILVUS_COLLECTION_KNOWLEDGE", "knowledge_base"),
      complaints: env("MILVUS_COLLECTION_COMPLAINTS", "complaint_cases"),
    },
  },

  llm: {
    apiKey: env("OPENAI_API_KEY"),
    baseUrl: env("OPENAI_BASE_URL", "https://api.deepseek.com/v1"),
    model: env("LLM_MODEL", "deepseek-chat"),
    embeddingModel: env("EMBEDDING_MODEL", "bge-m3"),
    embeddingBaseUrl: env("EMBEDDING_BASE_URL", "http://localhost:11434/v1"),
    embeddingApiKey: env("EMBEDDING_API_KEY", "ollama"),
    temperature: parseFloat(env("LLM_TEMPERATURE", "0.3")),
    maxTokens: envInt("LLM_MAX_TOKENS", 4096),
  },

  cvModel: {
    type: env("CV_MODEL_TYPE", "mimo") as "openai" | "claude" | "local" | "mimo",
    endpoint: env("CV_MODEL_ENDPOINT", "https://api.deepseek.com/v1"),
    apiKey: env("CV_MODEL_API_KEY"),
    modelName: env("CV_MODEL_NAME", "mimo-v2-omni"),
  },

  app: {
    secret: env("APP_SECRET", "dev-secret"),
    url: env("NEXT_PUBLIC_APP_URL", "http://localhost:3000"),
    wsUrl: env("NEXT_PUBLIC_WS_URL", "http://localhost:3000"),
  },

  auth: {
    jwtSecret: env("JWT_SECRET", "dev-jwt-secret"),
    jwtExpiration: env("JWT_EXPIRATION", "24h"),
    sessionTtl: envInt("SESSION_TTL", 86400),
  },

  rateLimit: {
    windowMs: envInt("RATE_LIMIT_WINDOW_MS", 60000),
    maxRequests: envInt("RATE_LIMIT_MAX_REQUESTS", 100),
  },

  upload: {
    maxSizeMb: envInt("MAX_UPLOAD_SIZE_MB", 10),
    dir: env("UPLOAD_DIR", "./uploads"),
  },

  mcp: {
    enabled: envBool("MCP_ENABLED", false),
    serverPort: envInt("MCP_SERVER_PORT", 3001),
  },
} as const;

export type Config = typeof config;
