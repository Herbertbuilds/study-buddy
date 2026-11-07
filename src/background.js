// Study Buddy — background service worker.

// One shared list of providers/models, loaded as a classic script. Must run
// before DEFAULT_SETTINGS / sanitizeSettings below reference DEFAULT_MODELS.
// ("scripts" paths resolve relative to this worker's URL, src/background.js.)
importScripts("shared-models.js");

// ---------- Settings ----------
const DEFAULT_SETTINGS = {
    provider: "gemini",
    geminiKeys: [],
    groqKeys: [],
    model: DEFAULT_MODELS.gemini,
    autoScan: true,
    answerStyle: "quick",
    modelsByProvider: {},
    darkMode: false,
};

function sanitizeSettings(raw) {
    const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
    const provider = merged.provider === "groq" ? "groq" : "gemini";
    merged.provider = provider;
    if (!MODEL_IDS[provider].has(merged.model)) {
        merged.model = DEFAULT_MODELS[provider];
    }

    merged.geminiKeys = Array.isArray(merged.geminiKeys)
        ? merged.geminiKeys
        : [];
    merged.groqKeys = Array.isArray(merged.groqKeys) ? merged.groqKeys : [];
    merged.darkMode = merged.darkMode === true;
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

    if (message.type === "scanDocument") {
        scanDocumentWithOffscreen(message.url)
            .then((text) => sendResponse({ ok: true, text }))
            .catch((err) =>
                sendResponse({
                    ok: false,
                    error: String(err?.message || err),
                }),
            );
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
                const cached = getCachedAnswer(message.question, settings);
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
                setCachedAnswer(message.question, settings, answer);
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

// ---------- PDF document scanning (via offscreen document) ----------
// Service workers can't use dynamic import() (needed by pdf.js) or most DOM
// APIs, so the actual extraction runs in a hidden offscreen document and the
// result is sent back here as a message.

async function ensureOffscreenDocument() {
    if (!chrome.offscreen) {
        throw new Error(
            "PDF scanning needs a newer version of this browser (offscreen documents are not supported).",
        );
    }
    const hasDocument = await chrome.offscreen.hasDocument().catch(() => false);
    if (hasDocument) return;
    await chrome.offscreen.createDocument({
        url: chrome.runtime.getURL("src/offscreen.html"),
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification:
            "Extract text from PDF documents so questions can be scanned.",
    });
}

async function scanDocumentWithOffscreen(url) {
    await ensureOffscreenDocument();
    const PDF_SCAN_TIMEOUT_MS = 90_000;
    try {
        // Without a timeout a stuck round-trip (offscreen page mid-creation,
        // hung download) would leave the popup "scanning" forever.
        const res = await Promise.race([
            chrome.runtime.sendMessage({ type: "pdf:getText", url }),
            new Promise((_, reject) =>
                setTimeout(
                    () =>
                        reject(
                            new Error(
                                "Scanning this document timed out. Try again, or use a shorter file.",
                            ),
                        ),
                    PDF_SCAN_TIMEOUT_MS,
                ),
            ),
        ]);
        if (!res || res.ok !== true)
            throw new Error(res?.error || "Could not read this document.");
        return res.text;
    } finally {
        // Don't keep a hidden page around between scans.
        try {
            if (await chrome.offscreen.hasDocument())
                await chrome.offscreen.closeDocument();
        } catch (_) {
            /* harmless on race — the document is gone either way */
        }
    }
}

// ---------- AI answer pipeline ----------

const CACHE_TTL_MS = 5 * 60 * 1000;
const answerCache = new Map(); // question -> { text, confidence, timestamp }

const CONFIDENCE_RE = /\n?\[\[confidence:\s*(high|medium|low)\]\]\s*$/i;

const CONFIDENCE_INSTRUCTION = `\nAfter your answer, on the very last line, rate your confidence that the answer is correct by writing exactly one of:
[[confidence: high]]  [[confidence: medium]]  [[confidence: low]]
Use "high" only when you are certain the answer is a specific fact you know precisely; "medium" when you know the topic but not every detail; "low" when you are unsure or guessing — even for practice-style questions with an obvious-feeling answer.
Base your explanation only on facts you know well. If any part of your explanation would require guessing, add one short line starting "I'm unsure:" naming exactly which part is uncertain. Do NOT fill gaps with invented terms, numbers, or steps, and never let confident-sounding wording exceed your actual certainty. Never omit the confidence line.`;

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

// gpt-oss models spend most of their token budget on hidden "reasoning" tokens
// before writing the visible answer, so they need a much larger max_tokens.
const GROQ_TOKEN_MULTIPLIER = 4;

function parseConfidence(text) {
    const m = text.match(CONFIDENCE_RE);
    const clean = m ? text.replace(CONFIDENCE_RE, "").trim() : text.trim();
    return { text: clean, confidence: m ? m[1].toLowerCase() : null };
}

function saveCacheKey(question) {
    return question.trim().toLowerCase().slice(0, 400);
}

// Cache key must include the model and answer style, not just the question
// text — otherwise switching Quick/Explain (or models) serves the stale
// answer from the previous style for up to the 5-minute TTL.
function cacheKeyFor(question, settings) {
    return [
        settings.answerStyle || "quick",
        settings.model,
        saveCacheKey(question),
    ].join("|");
}

function getCachedAnswer(question, settings) {
    const key = cacheKeyFor(question, settings);
    const entry = answerCache.get(key);
    if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) return entry;
    answerCache.delete(key);
    return null;
}

function setCachedAnswer(question, settings, answer) {
    answerCache.set(cacheKeyFor(question, settings), {
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
    let maxTokens = maxTokensFor(settings);
    // Thinking-style Gemini models spend part of their maxOutputTokens
    // budget on hidden "thought" tokens, which can leave the visible answer
    // empty before rendering. When the first call stops at MAX_TOKENS with
    // no visible text, retry once with a much larger budget (mirrors the
    // reasoning-model workaround on Groq) instead of erroring out.
    for (let attempt = 0; attempt < 2; attempt++) {
        const model = settings.model || DEFAULT_MODELS.gemini;
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
                    maxOutputTokens: maxTokens,
                },
            }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok)
            throw new Error(data?.error?.message || `HTTP ${res.status}`);
        const candidate = data?.candidates?.[0];
        const parts = candidate?.content?.parts;
        const text = Array.isArray(parts)
            ? parts.map((p) => p.text || "").join("")
            : "";
        if (text.trim()) return text.trim();
        if (candidate?.finishReason === "MAX_TOKENS" && attempt === 0) {
            maxTokens = maxTokens * 4;
            continue;
        }
        throw new Error("Gemini returned an empty response. Try again.");
    }
    throw new Error("Gemini returned an empty response. Try again.");
}

async function answerWithGroq(question, apiKey, settings) {
    let model = settings.model || DEFAULT_MODELS.groq;
    if (!MODEL_IDS.groq.has(model)) model = DEFAULT_MODELS.groq;
    const isReasoningModel = /^openai\/gpt-oss/.test(model);
    const body = {
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
        max_tokens: maxTokensFor(settings) * (isReasoningModel ? GROQ_TOKEN_MULTIPLIER : 1),
    };
    // gpt-oss models burn hidden reasoning tokens before answering; cap the
    // reasoning effort so the real answer fits in the token budget.
    if (isReasoningModel) body.reasoning_effort = "low";
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
    const choice = data?.choices?.[0];
    const text = choice?.message?.content || "";
    if (!text.trim()) {
        if (choice?.finish_reason === "length") {
            throw new Error(
                "The model ran out of tokens while thinking. Try again, or switch models in settings.",
            );
        }
        throw new Error("Groq returned an empty response. Try again.");
    }
    return text.trim();
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "scan-page") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/shared-renderer.js", "src/content.js"] });
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["src/content.css"] });
  } catch (_) { /* already injected */ }
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: "scan" });
    const count = res?.questions?.length || 0;
    await chrome.action.setBadgeText({ text: String(count), tabId: tab.id });
    await chrome.action.setBadgeBackgroundColor({ color: count > 0 ? "#4f46e5" : "#b91c1c", tabId: tab.id });
  } catch (_) {
    await chrome.action.setBadgeText({ text: "!", tabId: tab.id });
    await chrome.action.setBadgeBackgroundColor({ color: "#b91c1c", tabId: tab.id });
  }
});
