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
};

const GEMINI_MODELS = [
    { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash (recommended)" },
    { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite" },
    { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
    { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
];

const GROQ_MODELS = [
    { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B (recommended)" },
    { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B" },
    { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
    { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant" },
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
    qStyleQuickBtn: $("#qStyleQuickBtn"),
    qStyleExplainBtn: $("#qStyleExplainBtn"),
    quickModelSelect: $("#quickModelSelect"),
};

init();

async function init() {
    const res = await chrome.runtime.sendMessage({ type: "getSettings" });
    if (res && res.ok) settings = res.settings;

    els.providerSelect.value = settings.provider || "gemini";
    els.autoScanToggle.checked = settings.autoScan !== false;
    renderProviderUI(settings.provider || "gemini");
    populateModelSelect(settings.provider || "gemini");
    setAnswerStyleUI(settings.answerStyle || "quick");
    populateQuickModelSelect();

    els.settingsToggle.addEventListener("click", () =>
        els.settingsPanel.classList.remove("hidden"),
    );
    els.closeSettingsBtn.addEventListener("click", () =>
        els.settingsPanel.classList.add("hidden"),
    );
    els.backBtn.addEventListener("click", showMainView);
    els.scanBtn.addEventListener("click", scanPage);
    els.clearBtn.addEventListener("click", clearHighlights);

    els.providerSelect.addEventListener("change", () => {
        const p = els.providerSelect.value;
        els.groqFields.classList.toggle("hidden", p !== "groq");
        els.geminiFields.classList.toggle("hidden", p !== "gemini");
        populateModelSelect(p);
        populateQuickModelSelect();
    });

    els.addKeyBtn.addEventListener("click", (e) => {
        e.preventDefault();
        addKeyRow(els.apiKeyList, "");
        els.apiKeyList.querySelector(".key-input:last-child")?.focus();
    });
    els.addGeminiKeyBtn.addEventListener("click", (e) => {
        e.preventDefault();
        addKeyRow(els.geminiKeyList, "");
        els.geminiKeyList.querySelector(".key-input:last-child")?.focus();
    });

    els.saveSettings.addEventListener("click", saveSettings);

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
        await ensureContentScript(tab.id);
        const res = await chrome.tabs.sendMessage(tab.id, { type: "scan" });
        if (!res || !res.ok) throw new Error("No response from page.");
        renderQuestionList(res.questions || []);
        setStatus(
            res.questions.length === 0
                ? "No questions found on this page."
                : `Found ${res.questions.length} question${res.questions.length > 1 ? "s" : ""} — click one.`,
            res.questions.length === 0 ? "error" : "ok",
        );
    } catch (err) {
        const msg = err?.message || "";
        if (
            /Receiving end does not exist|Could not establish connection/i.test(
                msg,
            )
        ) {
            setStatus(
                "Content script not loaded. Reload this page and try again.",
                "error",
            );
        } else {
            setStatus(
                "Couldn't scan this page (PDFs and chrome:// pages can't be scanned). Try an HTML page.",
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
        await chrome.tabs.sendMessage(tab.id, { type: "clear" });
    } catch (_) {}
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
            target: { tabId },
            files: ["content.js"],
        });
    } catch (_) {}
    try {
        await chrome.scripting.insertCSS({
            target: { tabId },
            files: ["content.css"],
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

function addKeyRow(container, value) {
    const row = document.createElement("div");
    row.className = "key_row";
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
    removeBtn.addEventListener("click", () => row.remove());
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