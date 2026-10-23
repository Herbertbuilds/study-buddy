// Study Buddy — popup logic
const $ = (sel) => document.querySelector(sel);

let settings = {
    provider: "gemini",
    geminiKeys: [],
    groqKeys: [],
    model: "gemini-3.6-flash",
    autoScan: true,
    answerStyle: "quick",
    modelsByProvider: {},
    darkMode: false,
};

const GEMINI_MODELS = [
    { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash (recommended)" },
    { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash (newest)" },
    { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite (fastest)" },
    { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash (legacy)" },
];

// Llama 3.3/3.1 chat models are Enterprise-only on Groq since Aug 2026.
const GROQ_MODELS = [
    { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B (recommended)" },
    { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B" },
    { id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B (preview)" },
];

const DEFAULT_MODELS = {
    groq: "openai/gpt-oss-120b",
    gemini: "gemini-3.6-flash",
};

const els = {
    settingsToggle: $("#settingsToggle"),
    closeSettingsBtn: $("#closeSettingsBtn"),
    settingsPanel: $("#settingsPanel"),
    statusBar: $("#statusBar"),
    mainView: $("#mainView"),
    answerView: $("#answerView"),
    scanBtn: $("#scanBtn"),
    clearBtn: $("#clearBtn"),
    emptyState: $("#emptyState"),
    questionList: $("#questionList"),
    backBtn: $("#backBtn"),
    answerQuestion: $("#answerQuestion"),
    answerBody: $("#answerBody"),
    saveSettings: $("#saveSettings"),
    settingsMsg: $("#settingsMsg"),
    providerSelect: $("#providerSelect"),
    groqFields: $("#groqFields"),
    geminiFields: $("#geminiFields"),
    apiKeyList: $("#apiKeyList"),
    addKeyBtn: $("#addKeyBtn"),
    geminiKeyList: $("#geminiKeyList"),
    addGeminiKeyBtn: $("#addGeminiKeyBtn"),
    modelSelect: $("#modelSelect"),
    modelHint: $("#modelHint"),
    autoScanToggle: $("#autoScanToggle"),
    darkModeToggle: $("#darkModeToggle"),
    qStyleQuickBtn: $("#qStyleQuickBtn"),
    qStyleExplainBtn: $("#qStyleExplainBtn"),
    quickModelSelect: $("#quickModelSelect"),
    switchToGroqBtn: $("#switchToGroqBtn"),
    switchToGeminiBtn: $("#switchToGeminiBtn"),
};

init();

async function init() {
    const res = await chrome.runtime.sendMessage({ type: "getSettings" });
    if (res && res.ok) settings = res.settings;

    els.providerSelect.value = settings.provider || "gemini";
    els.autoScanToggle.checked = settings.autoScan !== false;
    els.darkModeToggle.checked = settings.darkMode === true;
    applyDarkMode(settings.darkMode === true);
    renderProviderUI(settings.provider || "gemini");
    populateModelSelect(settings.provider || "gemini");
    setAnswerStyleUI(settings.answerStyle || "quick");
    populateQuickModelSelect();
    updateProviderToggleUI(settings.provider || "gemini");

    updateAddKeyLabels();
    els.settingsToggle.addEventListener("click", () =>
        els.settingsPanel.classList.remove("hidden"),
    );
    els.closeSettingsBtn.addEventListener("click", () =>
        els.settingsPanel.classList.add("hidden"),
    );
    els.backBtn.addEventListener("click", showMainView);
    els.scanBtn.addEventListener("click", scanPage);
    els.clearBtn.addEventListener("click", clearHighlights);
    els.switchToGroqBtn.addEventListener("click", () => switchProvider("groq"));
    els.switchToGeminiBtn.addEventListener("click", () =>
        switchProvider("gemini"),
    );

    els.providerSelect.addEventListener("change", () => {
        const p = els.providerSelect.value;
        els.groqFields.classList.toggle("hidden", p !== "groq");
        els.geminiFields.classList.toggle("hidden", p !== "gemini");
        populateModelSelect(p);
        populateQuickModelSelect();
        updateProviderToggleUI(p);
    });

    els.addKeyBtn.addEventListener("click", (e) => {
        e.preventDefault();
        addKeyRow(els.apiKeyList, "");
        els.apiKeyList.querySelector(".key-input:last-child")?.focus();
        updateAddKeyLabels();
    });
    els.addGeminiKeyBtn.addEventListener("click", (e) => {
        e.preventDefault();
        addKeyRow(els.geminiKeyList, "");
        els.geminiKeyList.querySelector(".key-input:last-child")?.focus();
        updateAddKeyLabels();
    });

    els.saveSettings.addEventListener("click", saveSettings);

    els.darkModeToggle.addEventListener("change", async () => {
        const on = els.darkModeToggle.checked;
        settings.darkMode = on;
        applyDarkMode(on);
        const saved = await persistSettings();
        setStatus(
            saved
                ? on
                    ? "Dark mode on."
                    : "Dark mode off."
                : on
                  ? "Dark mode on for this session (could not save)."
                  : "Dark mode off for this session (could not save).",
            saved ? "ok" : "error",
        );
    });

    els.qStyleQuickBtn.addEventListener("click", () =>
        applyAnswerStyle("quick"),
    );
    els.qStyleExplainBtn.addEventListener("click", () =>
        applyAnswerStyle("explain"),
    );
    els.quickModelSelect.addEventListener("change", () => {
        const model = els.quickModelSelect.value;
        if (!model) return;
        const provider = settings.provider || "gemini";
        settings.modelsByProvider = settings.modelsByProvider || {};
        settings.modelsByProvider[provider] = model;
        settings.model = model;
        persistSettings();
    });

    setStatus("Ready.", "ok");
    await restoreLastScan();
}

// The popup document is destroyed when it closes, so remember the last scan
// and offer it again when the popup reopens on the same page.
const LAST_SCAN_TTL_MS = 15 * 60 * 1000;

async function restoreLastScan() {
    try {
        const [tab, { lastScan }] = await Promise.all([
            getActiveTab(),
            chrome.storage.local.get("lastScan"),
        ]);
        if (!lastScan || !lastScan.questions?.length) return;
        if (Date.now() - lastScan.ts > LAST_SCAN_TTL_MS) return;
        if (lastScan.url && tab.url && tab.url.startsWith(lastScan.url)) {
            renderQuestionList(lastScan.questions);
            setStatus(
                `Last scan: ${lastScan.questions.length} question${lastScan.questions.length > 1 ? "s" : ""}. Press "🔍 Scan this page" to refresh.`,
                "ok",
            );
        }
    } catch (_) {
        /* no tab or storage issue — start empty */
    }
}

function saveLastScan(url, questions) {
    chrome.storage.local
        .set({ lastScan: { url, ts: Date.now(), questions } })
        .catch(() => {});
}

// ---------- Document scanning (PDFs and multi-frame pages) ----------

function looksLikePdfUrl(url) {
    if (!url) return false;
    try {
        return /\.pdf([?#]|$)/i.test(new URL(url).pathname + new URL(url).search)
            || /\.pdf#/i.test(url);
    } catch (_) {
        return false;
    }
}

// PDFs render in a native viewer with no DOM to scan, so the background
// worker downloads and parses the file, and questions are listed in the
// popup only (the viewer page can't be highlighted).
async function scanPdfDocument(tab) {
    const url = tab.url;
    if (/^https?:/i.test(url)) {
        const origin = new URL(url).origin + "/*";
        let granted = await chrome.permissions
            .contains({ origins: [origin] })
            .catch(() => false);
        if (!granted) {
            try {
                granted = await chrome.permissions.request({ origins: [origin] });
            } catch (_) {
                granted = false;
            }
        }
        if (!granted) {
            setStatus(
                "Access to this document's site was denied, so it can't be scanned.",
                "error",
            );
            return [];
        }
    }
    const res = await chrome.runtime.sendMessage({
        type: "scanDocument",
        url,
    });
    if (!res || !res.ok)
        throw new Error(res?.error || "Could not read this document.");
    const questions = questionsFromDocumentText(res.text || "");
    renderQuestionList(questions);
    setStatus(
        questions.length
            ? `Found ${questions.length} question${questions.length > 1 ? "s" : ""} in this document — answers open in the popup. Click one.`
            : "No questions found in this document.",
        questions.length ? "ok" : "error",
    );
    return questions;
}

// Heuristic extraction from plain document text: chunks are anchored on
// numbered question markers ("1." / "12)") at paragraph starts; a chunk is a
// question when it holds option markers (A. B. C…) or ends with "?".
const DOC_QUESTION_SPLIT_RE =
    /(?:^|\n)\s*\d{1,3}[.)]\s+(?=[^\n]{15,})/g;

function questionsFromDocumentText(raw) {
    const MAX_DOC_QUESTIONS = 40;
    const text = (raw || "").replace(/\r/g, "").replace(/[ \t]+/g, " ");
    const anchors = [...text.matchAll(DOC_QUESTION_SPLIT_RE)];
    const chunks = [];
    for (let i = 0; i < anchors.length; i++) {
        const start = anchors[i].index;
        const end =
            i + 1 < anchors.length ? anchors[i + 1].index : text.length;
        chunks.push(text.slice(start, end));
    }
    const questions = [];
    for (const chunk of chunks) {
        const flat = chunk.replace(/\s+/g, " ").trim();
        if (flat.length < 20 || flat.length > 1500) continue;
        const markers = (flat.match(/(?:^|\s)[A-E][.)]\s/g) || []).length;
        const tfCount = (flat.match(/\b(?:true|false)\b/gi) || []).length;
        if (markers >= 2 && markers <= 8) questions.push({ text: flat });
        else if (tfCount >= 2) questions.push({ text: flat });
        else if (/\?/.test(flat)) questions.push({ text: flat });
        if (questions.length >= MAX_DOC_QUESTIONS) break;
    }
    return questions;
}

function showMainView() {
    els.answerView.classList.add("hidden");
    els.mainView.classList.remove("hidden");
}

async function scanPage() {
    els.scanBtn.disabled = true;
    els.scanBtn.textContent = "Scanning…";
    setStatus("Scanning the page for questions…", "");
    try {
        const tab = await getActiveTab();
        if (looksLikePdfUrl(tab.url)) {
            const docQuestions = await scanPdfDocument(tab);
            saveLastScan((tab.url || "").split("#")[0], docQuestions);
            return;
        }
        await ensureContentScript(tab.id);
        // Collect candidates from every frame (top page + iframes). The scan
        // results come back per frame from the injected script itself.
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            func: () => (window.__studyBuddy ? window.__studyBuddy.scan() : []),
        });
        const perFrame = (results || []).filter((r) => (r.result || []).length);
        await Promise.all(
            perFrame.map((r) =>
                chrome.scripting.executeScript({
                    target: { tabId: tab.id, frameIds: [r.frameId] },
                    func: () => window.__studyBuddy?.highlight(),
                }),
            ),
        );
        const seen = new Set();
        const questions = [];
        for (const frame of perFrame) {
            for (const q of frame.result || []) {
                const key = q.text.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                questions.push({ text: q.text });
            }
        }
        renderQuestionList(questions);
        saveLastScan((tab.url || "").split("#")[0], questions);
        setStatus(
            questions.length === 0
                ? "No questions found on this page."
                : `Found ${questions.length} question${questions.length > 1 ? "s" : ""} — click one.`,
            questions.length === 0 ? "error" : "ok",
        );
    } catch (err) {
        const msg = err?.message || "";
        if (
            /Receiving end does not exist|Could not establish connection|Cannot access contents/i.test(
                msg,
            )
        ) {
            let fileUrl = "";
            try {
                fileUrl = (await getActiveTab()).url || "";
            } catch (_) {}
            if (fileUrl.startsWith("file:")) {
                setStatus(
                    "Local files need one-time permission: open chrome://extensions → Study Buddy → Details → switch on “Allow access to file URLs”, then scan again.",
                    "error",
                );
            } else {
                setStatus(
                    "Content script not loaded. Reload this page and try again.",
                    "error",
                );
            }
        } else {
            setStatus(
                msg
                    ? `Couldn't scan: ${msg}`
                    : "Couldn't scan this page (chrome:// pages can't be scanned). Try an HTML page.",
                "error",
            );
        }
    } finally {
        els.scanBtn.disabled = false;
        els.scanBtn.textContent = "🔍 Scan this page";
    }
}

async function clearHighlights() {
    try {
        const tab = await getActiveTab();
        await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            func: () => {
                try {
                    window.__studyBuddy?.clear();
                } catch (_) {}
            },
        });
    } catch (_) {}
    chrome.storage.local.remove("lastScan").catch(() => {});
    renderQuestionList([]);
    setStatus("Highlights cleared.", "ok");
}

async function getActiveTab() {
    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
    });
    if (!tab || tab.id == null) throw new Error("No active tab");
    return tab;
}

async function ensureContentScript(tabId) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            files: ["src/content.js"],
        });
    } catch (_) {}
    try {
        await chrome.scripting.insertCSS({
            target: { tabId, allFrames: true },
            files: ["src/content.css"],
        });
    } catch (_) {}
}

function renderQuestionList(list) {
    const questions = list.map((q, i) => ({ text: q.text, index: i }));
    els.emptyState.classList.toggle("hidden", questions.length > 0);
    els.clearBtn.classList.toggle("hidden", questions.length === 0);
    els.questionList.innerHTML = "";
    for (const q of questions) {
        const li = document.createElement("li");
        li.setAttribute("tabindex", "0");
        li.setAttribute("role", "button");
        li.setAttribute("aria-label", `Question ${q.index + 1}: ${q.text}`);
        const num = document.createElement("span");
        num.className = "question-num";
        num.textContent = String(q.index + 1);
        const text = document.createElement("span");
        text.className = "question-text";
        text.textContent = q.text;
        li.appendChild(num);
        li.appendChild(text);
        li.addEventListener("click", () => answerQuestion(q.text));
        li.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                answerQuestion(q.text);
            } else if (e.key === "ArrowDown") {
                e.preventDefault();
                li.nextElementSibling?.focus();
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                li.previousElementSibling?.focus();
            }
        });
        els.questionList.appendChild(li);
    }
}

function renderProviderUI(provider) {
    els.providerSelect.value = provider;
    els.groqFields.classList.toggle("hidden", provider !== "groq");
    els.geminiFields.classList.toggle("hidden", provider !== "gemini");
    if (provider === "groq") {
        els.apiKeyList.innerHTML = "";
        for (const k of settings.groqKeys || []) addKeyRow(els.apiKeyList, k);
    } else {
        els.geminiKeyList.innerHTML = "";
        for (const k of settings.geminiKeys || [])
            addKeyRow(els.geminiKeyList, k);
    }
}

function populateModelSelect(provider) {
    const select = els.modelSelect;
    select.innerHTML = "";
    const models = provider === "groq" ? GROQ_MODELS : GEMINI_MODELS;
    els.modelHint.textContent =
        provider === "groq"
            ? "Groq hosts OpenAI-format models only. Gemini models won't work with Groq."
            : "Free-tier friendly: Gemini 3.6 Flash, Gemini 3.5 Flash Lite.";
    for (const m of models) {
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = m.label;
        select.appendChild(opt);
    }
    select.value = models.some((m) => m.id === settings.model)
        ? settings.model
        : DEFAULT_MODELS[provider] || models[0].id;
}

// Labels depend on how many keys are filled right now, saved or not.
function updateAddKeyLabels() {
    for (const [btn, list] of [
        [els.addKeyBtn, els.apiKeyList],
        [els.addGeminiKeyBtn, els.geminiKeyList],
    ]) {
        btn.textContent =
            getKeyValues(list).length === 0 ? "+ Add a key" : "+ Add another key";
    }
}

function addKeyRow(container, value) {
    const row = document.createElement("div");
    row.className = "key-row";
    const input = document.createElement("input");
    input.type = "password";
    input.className = "key-input";
    input.placeholder = "gsk_... or AIza...";
    input.autocomplete = "off";
    input.value = value || "";
    const removeBtn = document.createElement("button");
    removeBtn.className = "key-remove";
    removeBtn.textContent = "✕";
    removeBtn.title = "Remove key";
    removeBtn.addEventListener("click", () => {
        row.remove();
        updateAddKeyLabels();
    });
    row.appendChild(input);
    row.appendChild(removeBtn);
    container.appendChild(row);
}

function getKeyValues(container) {
    return Array.from(container.querySelectorAll(".key-input"))
        .map((i) => i.value.trim())
        .filter((v) => v.length > 0);
}

async function saveSettings() {
    els.settingsMsg.className = "msg";
    const provider = els.providerSelect.value;
    const activeList = provider === "groq" ? els.apiKeyList : els.geminiKeyList;
    const keys = getKeyValues(activeList);
    if (keys.length === 0) {
        els.settingsMsg.textContent = `Please paste at least one ${provider === "groq" ? "Groq" : "Gemini"} API key.`;
        els.settingsMsg.classList.add("error");
        return;
    }
    settings = {
        provider,
        geminiKeys: provider === "groq" ? settings.geminiKeys || [] : keys,
        groqKeys: provider === "groq" ? keys : settings.groqKeys || [],
        model: els.modelSelect.value,
        autoScan: els.autoScanToggle.checked,
        answerStyle: settings.answerStyle || "quick",
        modelsByProvider: settings.modelsByProvider || {},
        darkMode: els.darkModeToggle.checked,
    };
    const res = await chrome.runtime.sendMessage({
        type: "saveSettings",
        settings,
    });
    if (res && res.ok) {
        settings = res.settings;
        els.settingsMsg.textContent = "Saved ✓";
        els.settingsMsg.classList.add("ok");
        setStatus(
            `${keys.length} key${keys.length > 1 ? "s" : ""} configured — ready to scan.`,
            "ok",
        );
        setTimeout(() => els.settingsPanel.classList.add("hidden"), 400);
    } else {
        els.settingsMsg.textContent = "Could not save settings. Try again.";
        els.settingsMsg.classList.add("error");
    }
}

function applyDarkMode(on) {
    document.body.classList.toggle("dark", !!on);
}

function setAnswerStyleUI(style) {
    const isQuick = style !== "explain";
    els.qStyleQuickBtn.classList.toggle("active", isQuick);
    els.qStyleExplainBtn.classList.toggle("active", !isQuick);
    els.qStyleQuickBtn.setAttribute("aria-checked", String(isQuick));
    els.qStyleExplainBtn.setAttribute("aria-checked", String(!isQuick));
}

async function applyAnswerStyle(style) {
    if (settings.answerStyle === style) return;
    setAnswerStyleUI(style);
    settings.answerStyle = style;
    const saved = await persistSettings();
    setStatus(
        saved
            ? style === "explain"
                ? "Explain mode on."
                : "Quick answers on."
            : "Could not save — try again.",
        saved ? "ok" : "error",
    );
}

function openSettings() {
    els.settingsPanel.classList.remove("hidden");
}

function updateProviderToggleUI(provider) {
    els.switchToGroqBtn.classList.toggle("active", provider === "groq");
    els.switchToGeminiBtn.classList.toggle("active", provider === "gemini");
}

async function switchProvider(provider) {
    if (settings.provider === provider) return;
    settings.provider = provider;
    els.providerSelect.value = provider;
    renderProviderUI(provider);
    populateModelSelect(provider);
    populateQuickModelSelect();
    updateProviderToggleUI(provider);

    const keys = provider === "groq" ? settings.groqKeys : settings.geminiKeys;
    if (!keys || keys.length === 0) {
        setStatus(
            `Add your ${provider === "groq" ? "Groq" : "Gemini"} API key to get started.`,
            "error",
        );
        openSettings();
        return;
    }
    const saved = await persistSettings();
    setStatus(
        saved
            ? `Switched to ${provider === "groq" ? "Groq" : "Gemini"}.`
            : "Could not save — try again.",
        saved ? "ok" : "error",
    );
}

async function persistSettings() {
    try {
        const res = await chrome.runtime.sendMessage({
            type: "saveSettings",
            settings,
        });
        return !!(res && res.ok);
    } catch {
        return false;
    }
}

function populateQuickModelSelect() {
    const provider = settings.provider || "gemini";
    const models = provider === "groq" ? GROQ_MODELS : GEMINI_MODELS;
    const select = els.quickModelSelect;
    select.innerHTML = "";
    for (const m of models) {
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = m.label;
        select.appendChild(opt);
    }
    const remembered = settings.modelsByProvider?.[provider];
    const useModel =
        remembered && models.some((m) => m.id === remembered)
            ? remembered
            : models.some((m) => m.id === settings.model)
              ? settings.model
              : DEFAULT_MODELS[provider] || models[0].id;
    select.value = useModel;
    if (settings.model !== useModel) settings.model = useModel;
}

function buildConfidenceBadge(confidence) {
    const meta = {
        high: { label: "High confidence" },
        medium: { label: "Medium confidence" },
        low: { label: "Low confidence — double-check" },
    }[confidence];
    if (!meta) return null;
    const wrap = document.createElement("div");
    wrap.className = "confidence-badge confidence-" + confidence;
    wrap.textContent = meta.label;
    return wrap;
}

async function answerQuestion(questionText) {
    els.mainView.classList.add("hidden");
    els.answerView.classList.remove("hidden");
    els.answerQuestion.textContent = questionText;
    els.answerBody.innerHTML = '<div class="spinner"></div>';
    setStatus("Asking AI…", "");
    try {
        const res = await chrome.runtime.sendMessage({
            type: "answerQuestion",
            question: questionText,
        });
        els.answerBody.innerHTML = "";
        if (res && res.ok) {
            if (res.confidence) {
                const badge = buildConfidenceBadge(res.confidence);
                if (badge) els.answerBody.appendChild(badge);
            }
            const out = document.createElement("div");
            out.innerHTML = renderMarkdown(escapeHtml(res.answer));
            els.answerBody.appendChild(out);
            setStatus("Answer ready ✓", "ok");
        } else {
            const out = document.createElement("div");
            out.style.color = "var(--danger)";
            out.textContent = res?.error || "Something went wrong.";
            els.answerBody.appendChild(out);
            setStatus("Something went wrong.", "error");
        }
    } catch (err) {
        els.answerBody.innerHTML = "";
        const out = document.createElement("div");
        out.style.color = "var(--danger)";
        out.textContent = String(err?.message || "Extension reloaded. Retry.");
        els.answerBody.appendChild(out);
        setStatus("Something went wrong.", "error");
    }
}

function escapeHtml(s) {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function renderMarkdown(html) {
    return html
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*]+)\*/g, "<em>$1</em>")
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .split(/\n{2,}/)
        .map((block) => {
            if (/^[-*]\s/.test(block.trim())) {
                const items = block
                    .trim()
                    .split(/\n/)
                    .filter((l) => /^[-*]\s/.test(l.trim()))
                    .map((l) => `<li>${l.replace(/^[-*]\s/, "")}</li>`)
                    .join("");
                return `<ul>${items}</ul>`;
            }
            return `<p>${block.replace(/\n/g, "<br>")}</p>`;
        })
        .join("");
}

function setStatus(text, kind) {
    els.statusBar.textContent = text;
    els.statusBar.className = "status" + (kind ? " " + kind : "");
}
