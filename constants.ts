
export const AI_MODELS = {
    GEMINI_FLASH: 'gemini-2.5-flash',
    GEMINI_IMAGEN: 'imagen-4.0-generate-001',
    OPENAI_GPT4_TURBO: 'gpt-4o',
    OPENAI_DALLE3: 'dall-e-3',
    ANTHROPIC_OPUS: 'claude-3-opus-20240229',
    ANTHROPIC_HAIKU: 'claude-3-haiku-20240307',
    OPENROUTER_DEFAULT: [
        'google/gemini-2.5-flash',
        'anthropic/claude-3-haiku',
        'microsoft/wizardlm-2-8x22b',
        'openrouter/auto'
    ],
    GROQ_MODELS: [
        'llama3-70b-8192',
        'llama3-8b-8192',
        'mixtral-8x7b-32768',
        'gemma-7b-it',
    ]
};

// ==========================================
// CONTENT & SEO REQUIREMENTS (STRICT ENFORCEMENT)
// ==========================================
export const TARGET_MIN_WORDS = 2200; // Strict Minimum
export const TARGET_MAX_WORDS = 2800; // Strict Maximum
export const TARGET_MIN_WORDS_PILLAR = 3500; 
export const TARGET_MAX_WORDS_PILLAR = 4500;
export const YOUTUBE_EMBED_COUNT = 2;
export const MIN_INTERNAL_LINKS = 6;
export const MAX_INTERNAL_LINKS = 12;
export const MIN_TABLES = 3;
export const FAQ_COUNT = 8;
export const KEY_TAKEAWAYS = 8;

export const IMGUR_CLIENT_ID = '546c25a59c58ad7';
export const CACHE_TTL = {
    SERP: 86400000, // 24h
    VIDEOS: 259200000, // 72h
    REFERENCES: 604800000 // 7 days
};