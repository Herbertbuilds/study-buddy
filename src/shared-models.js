// Study Buddy — single source of truth for providers and models.
// Loaded as a classic script in BOTH the popup (via popup.html) and the
// background service worker (via importScripts in background.js), so there
// is exactly one list to keep in sync. Previously the popup and the worker
// each kept their own copy, and adding a model in one but not the other
// made sanitizeSettings silently snap the saved model back to the default.

const PROVIDER_MODELS = {
    gemini: [
        { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash (recommended)" },
        { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash (newest)" },
        {
            id: "gemini-3.5-flash-lite",
            label: "Gemini 3.5 Flash Lite (fastest)",
        },
        { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite" },
        { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash (legacy)" },
    ],
    // Llama 3.3/3.1 chat models are Enterprise-only on Groq since Aug 2026.
    groq: [
        { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B (recommended)" },
        { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B" },
        { id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B (preview)" },
    ],
};

const DEFAULT_MODELS = {
    groq: "openai/gpt-oss-120b",
    gemini: "gemini-3.6-flash",
};

// Quick membership checks (used by the service worker to validate the
// saved model against the active provider).
const MODEL_IDS = {
    gemini: new Set(PROVIDER_MODELS.gemini.map((m) => m.id)),
    groq: new Set(PROVIDER_MODELS.groq.map((m) => m.id)),
};
