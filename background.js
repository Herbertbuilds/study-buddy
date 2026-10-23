// Study Buddy — background service worker.
// ---------- Settings ----------

const DEFAULT_SETTINGS = {
    provider: "gemini",
    geminiKeys: [],
    groqKeys: [],
    model: "gemini-3.6-flash",
    autoScan: true,
    answerStyle: "quick",
    modelsByProvider: {},
};

const GROQ_MODELS = new Set([
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
]);

const GEMINI_MODELS = new Set([
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.8-flash",
    "gemini-3.5-flash",
    "gemini-2.5-flash",
]);

function defaultModelForProvider(provider) {
    return provider === "groq" ? "openai/gpt-oss-120b" : "gemini-3.6-flash";
}

function sanitizeSettings(raw) {
    const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
    if (merged.provider === "groq" && !GROQ_MODELS.has(merged.model)) {
        merged.model = defaultModelForProvider("groq");
    } else if (
        merged.provider === "gemini" &&
        !GEMINI_MODELS.has(merged.model)
    ) {
        merged.model = defaultModelForProvider("gemini");
    }

    merged.geminiKeys = Array.isArray(merged.geminiKeys)
        ? merged.geminiKeys
        : [];
    merged.groqKeys = Array.isArray(merged.groqKeys) ? merged.groqKeys : [];
    merged.modelsByProvider =
        merged.modelsByProvider && typeof merged.modelsByProvider === "object"
            ? merged.modelsByProvider
            : {};
    return merged;
}

function getActiveKeys(settings) {
    const provider = settings.provider || "gemini";
    return provider === "groq" ? settings.groqKeys : settings.geminiKeys;
}

chrome.runtime.onInstalled.addListener(async () => {
    const existing = await chrome.storage.local.get("settings");
    if (!existing.settings) {
        await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
    }
});

// ---------- Message router ----------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "getSettings") {
        chrome.storage.local.get("settings").then(({ settings }) => {
            const merged = sanitizeSettings(settings);
            sendResponse({ ok: true, settings: merged });
        });
        return true;
    }

    if (message.type === "saveSettings") {
        chrome.storage.local.get("settings").then(({ settings: existing }) => {
            const merged = sanitizeSettings({
                ...(existing || {}),
                ...(message.settings || {}),
            });
            return chrome.storage.local.set({ settings: merged }).then(() => {
                sendResponse({ ok: true, settings: merged });
            });
        });
        return true;
    }

    if (message.type === "answerQuestion") {
        chrome.storage.local.get("settings").then(async ({ settings }) => {
            settings = sanitizeSettings(settings);
            if (getActiveKeys(settings).length === 0) {
                const providerName =
                    settings.provider === "groq" ? "Groq" : "Gemini";
                sendResponse({
                    ok: false,
                    error: `No API key yet. Open Study Buddy's settings and add your free ${providerName} API key.`,
                });
                return;
            }
            try {
                const cached = getCachedAnswer(message.question);
                if (cached) {
                    sendResponse({
                        ok: true,
                        answer: cached.text,
                        confidence: cached.confidence,
                    });
                    return;
                }
                const answer = await answerWithKeyRotation(
                    message.question,
                    settings,
                );
                setCachedAnswer(message.question, answer);
                sendResponse({
                    ok: true,
                    answer: answer.text,
                    confidence: answer.confidence,
                });
            } catch (err) {
                sendResponse({ ok: false, error: friendlyError(err) });
            }
        });
        return true;
    }
});

// ---------- AI answer pipeline ----------

const CACHE_TTL_MS = 5 * 60 * 1000;
const answerCache = new Map();

const CONFIDENCE_RE = /\n?\[\[confidence:\s*(high|medium|low)\]\]\s*$/i;

const CONFIDENCE_INSTRUCTION = `\nAfter your answer, on the very last line, rate your confidence that the answer is correct by writing exactly one of:
[[confidence: high]]  [[confidence: medium]]  [[confidence: low]]
Use "high" only when you are sure; "medium" when reasonably sure but some doubt; "low" when the question is ambiguous, options are unclear, or you are mostly guessing. Never omit the line.`;

const QUICK_PROMPT =
    `Answer exam questions concisely. For MCQs, give the letter AND option text in **bold**.` +
    CONFIDENCE_INSTRUCTION;

const EXPLAIN_PROMPT =
    `You are a tutor helping a student understand, not just answer. Structure your reply as:
1. **Answer:** the answer in **bold** (for MCQs, the letter AND option text).
2. **Why:** a step-by-step explanation of the reasoning, referencing the relevant concepts. 3-6 sentences for MCQs, more for open questions.
3. If the other options (or the common wrong approach) are tempting, add one line starting with "Watch out:" explaining the most likely mistake.
Keep the tone direct and clear. Never cut your explanation short — finish your thought.` +
    CONFIDENCE_INSTRUCTION;

function maxTokensFor(settings) {
    return settings.answerStyle === "explain" ? 900 : 300;
}

function parseConfidence(text) {
    const m = text.match(CONFIDENCE_RE);
    const clean = m ? text.replace(CONFIDENCE_RE, "").trim() : text.trim();
    return { text: clean, confidence: m ? m[1].toLowerCase() : null };
}

function saveCacheKey(question) {
    return question.trim().toLowerCase().slice(0, 400);
}

function getCachedAnswer(question) {
    const entry = answerCache.get(saveCacheKey(question));
    if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) return entry;
    answerCache.delete(saveCacheKey(question));
    return null;
}

function setCachedAnswer(question, answer) {
    answerCache.set(saveCacheKey(question), {
        text: answer.text,
        confidence: answer.confidence,
        timestamp: Date.now(),
    });
    if (answerCache.size > 100) {
        answerCache.delete(answerCache.keys().next().value);
    }
}

function friendlyError(err) {
    const msg = String(err?.message || err);
    if (
        /API key not valid|API_KEY_INVALID|PERMISSION_DENIED|invalid_api_key/i.test(
            msg,
        )
    ) {
        return "Your API key was rejected. Check it in Study Buddy's settings.";
    }
    if (/429|RESOURCE_EXHAUSTED|rate limit|Rate limit/i.test(msg)) {
        return "Rate limit reached. Wait ~30 seconds and try again, or add another key in settings.";
    }
    if (/quota|Quota/i.test(msg)) {
        return "Free-tier quota reached for today. Add another key in settings, or wait for quota to reset.";
    }
    if (
        /model/i.test(msg) &&
        /not found|not supported|no longer available/i.test(msg)
    ) {
        return "That model isn't available. In settings, try a different model.";
    }
    return `Something went wrong: ${msg}`;
}

let currentKeyIndex = 0;

function isQuotaOrRateError(msg) {
    return /429|RESOURCE_EXHAUSTED|rate limit|quota/i.test(msg);
}

async function answerWithKeyRotation(question, settings) {
    const keys = getActiveKeys(settings).filter((k) => k && k.trim());
    if (keys.length === 0) throw new Error("No API keys configured.");
    const callFn =
        settings.provider === "groq" ? answerWithGroq : answerWithGemini;

    for (let attempt = 0; attempt < keys.length; attempt++) {
        const idx = (currentKeyIndex + attempt) % keys.length;
        try {
            const raw = await callFn(question, keys[idx], settings);
            currentKeyIndex = idx;
            return parseConfidence(raw);
        } catch (err) {
            const msg = String(err?.message || "");
            if (isQuotaOrRateError(msg) && attempt < keys.length - 1) {
                currentKeyIndex = (idx + 1) % keys.length;
                continue;
            }
            throw err;
        }
    }
    throw new Error(
        "All API keys hit their limit. Add another key in settings, or wait for quota to reset.",
    );
}

async function answerWithGemini(question, apiKey, settings) {
    const model = settings.model || DEFAULT_SETTINGS.model;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: question }] }],
            systemInstruction: {
                parts: [
                    {
                        text:
                            settings.answerStyle === "explain"
                                ? EXPLAIN_PROMPT
                                : QUICK_PROMPT,
                    },
                ],
            },
            generationConfig: {
                temperature: 0.2,
                maxOutputTokens: maxTokensFor(settings),
            },
        }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
    const parts = data?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts)
        ? parts.map((p) => p.text || "").join("")
        : "";
    if (!text.trim())
        throw new Error("Gemini returned an empty response. Try again.");
    return text.trim();
}

async function answerWithGroq(question, apiKey, settings) {
    let model = settings.model || defaultModelForProvider("groq");
    if (!GROQ_MODELS.has(model)) model = defaultModelForProvider("groq");
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages: [
                {
                    role: "system",
                    content:
                        settings.answerStyle === "explain"
                            ? EXPLAIN_PROMPT
                            : QUICK_PROMPT,
                },
                { role: "user", content: question },
            ],
            temperature: 0.2,
            max_tokens: maxTokensFor(settings),
        }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
    const text = data?.choices?.[0]?.message?.content || "";
    if (!text.trim())
        throw new Error("Groq returned an empty response. Try again.");
    return text.trim();
}