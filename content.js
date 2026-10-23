// Study Buddy — content script: scan page, highlight questions.
(() => {
    if (window.__studyBuddyInjected) return;
    window.__studyBuddyInjected = true;

    const MAX_QUESTIONS = 40;
    const BADGE_CLASS = "sb-badge";
    const HIGHLIGHT_CLASS = "sb-highlighted";

    const CONFIDENCE_META = {
        high: { label: "High confidence" },
        medium: { label: "Medium confidence" },
        low: { label: "Low confidence — double-check" },
    };

    let questions = [];
    let selectBtn = null;

    const cleanText = (el) => (el.innerText || "").replace(/\s+/g, " ").trim();

    function depthOf(el) {
        let d = 0;
        let n = el;
        while (n.parentElement) {
            d++;
            n = n.parentElement;
        }
        return d;
    }

    function optionMarkerCount(text) {
        const m = text.match(/(?:^|\s)([A-E])[.)]\s/g);
        return m ? m.length : 0;
    }

    function trueFalseCount(text) {
        const m = text.match(/(?:^|\s)(true|false)(?:\s|[.,;:)]|$)/gi);
        return m ? m.length : 0;
    }

    const inIgnoredContext = (el) =>
        !!el.closest(
            "nav,header,footer,aside,menu,script,style,noscript,template,textarea,input,select,option,svg,canvas,iframe,code,pre,[role='navigation'],[role='menu']",
        );

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

    function scanQuestions() {
        questions = [];
        const selector =
            "p,li,div,span,td,th,h1,h2,h3,h4,h5,h6,label,legend,blockquote,section,dt,dd,summary";
        const all = Array.from(document.querySelectorAll(selector));
        const mcBlocks = new Set();

        for (const el of all) {
            if (inIgnoredContext(el)) continue;
            const text = cleanText(el);
            if (!text || text.length < 10 || text.length > 800) continue;
            const markers = optionMarkerCount(text);
            const tf = trueFalseCount(text) >= 2 && text.length >= 15;
            const stem = text.match(/(?:^|\s)([A-E])[.)]\s/);
            const stemLen = stem ? text.slice(0, stem.index).trim().length : 0;
            const isMc = (markers >= 2 && markers <= 8 && stemLen >= 8) || tf;
            if (!isMc) continue;
            let nested = false;
            for (const b of mcBlocks)
                if (b.contains(el)) {
                    nested = true;
                    break;
                }
            if (!nested) mcBlocks.add(el);
        }

        const generic = [];
        for (const el of all) {
            if (inIgnoredContext(el)) continue;
            let inside = false;
            for (const b of mcBlocks)
                if (b.contains(el)) {
                    inside = true;
                    break;
                }
            if (inside) continue;
            const text = cleanText(el);
            if (!text || text.length < 10 || text.length > 600) continue;
            if (/\?\s*$/.test(text)) continue;
            generic.push({ el, text });
        }

        const seen = new Set();
        const picked = [];
        for (const c of [...mcBlocks, ...generic].sort(
            (a, b) => depthOf(b.el) - depthOf(a.el),
        )) {
            const key = c.text.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            picked.push(c);
            if (picked.length >= MAX_QUESTIONS) break;
        }

        questions = picked.map((c, i) => ({
            el: c.el,
            text: c.text,
            index: i,
        }));
        return questions.map((q) => ({ index: q.index, text: q.text }));
    }

    function highlightQuestions() {
        removeHighlights();
        for (const q of questions) {
            q.el.classList.add(HIGHLIGHT_CLASS);
            const badge = document.createElement("span");
            badge.className = BADGE_CLASS;
            badge.textContent = String(q.index + 1);
            q.el.prepend(badge);
        }
    }

    function removeHighlights() {
        document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((el) => {
            el.classList.remove(HIGHLIGHT_CLASS);
            el.querySelectorAll(`.${BADGE_CLASS}`).forEach((b) => b.remove());
        });
    }

    async function askGemini(questionText) {
        try {
            const res = await chrome.runtime.sendMessage({
                type: "answerQuestion",
                question: questionText,
            });
            if (!res || !res.ok) {
                throw new Error(
                    res?.error ||
                        "Could not reach the Study Buddy background worker.",
                );
            }
            return { answer: res.answer, confidence: res.confidence || null };
        } catch (err) {
            const msg = String(err?.message || err);
            if (
                /context invalidated|receiving end does not exist|Could not establish connection/i.test(
                    msg,
                )
            ) {
                throw new Error(
                    "Extension was reloaded. Refresh the page and try again.",
                );
            }
            throw err;
        }
    }

    let cardEl = null;

    function createCard(questionText) {
        dismissCard();
        cardEl = document.createElement("div");
        cardEl.className = "sb-card";
        cardEl.innerHTML = `
    <div class="sb-card-head">
      <span class="sb-card-title">Study Buddy</span>
      <button class="sb-card-close" title="Close">&times;</button>
    </div>
    <div class="sb-card-question"></div>
    <div class="sb-card-body"><div class="sb-spinner"></div></div>
  `;
        cardEl.querySelector(".sb-card-question").textContent = questionText;
        cardEl
            .querySelector(".sb-card-close")
            .addEventListener("click", dismissCard);
        document.body.appendChild(cardEl);
        return cardEl;
    }

    function showAnswerCard(anchorEl, questionText) {
        createCard(questionText);
        cardEl._anchor = anchorEl;
        positionCard(anchorEl);
        hideBadges();
        loadAnswer(questionText);
    }

    function showAnswerCardAt(rect, questionText) {
        createCard(questionText);
        positionCardAtRect(rect);
        hideBadges();
        loadAnswer(questionText);
    }

    function loadAnswer(questionText) {
        askGemini(questionText)
            .then(({ answer, confidence }) => {
                if (!cardEl) return;
                const body = cardEl.querySelector(".sb-card-body");
                body.innerHTML = "";
                if (confidence && CONFIDENCE_META[confidence]) {
                    const badge = document.createElement("div");
                    badge.className =
                        "sb-card-confidence sb-confidence-" + confidence;
                    badge.textContent = CONFIDENCE_META[confidence].label;
                    body.appendChild(badge);
                }
                const out = document.createElement("div");
                out.className = "sb-card-answer";
                out.innerHTML = renderMarkdown(escapeHtml(answer));
                body.appendChild(out);
            })
            .catch((err) => {
                if (!cardEl) return;
                const body = cardEl.querySelector(".sb-card-body");
                body.innerHTML = "";
                const out = document.createElement("div");
                out.className = "sb-card-error";
                out.textContent = err.message;
                body.appendChild(out);
            });
    }

    function positionCard(anchorEl) {
        const rect = anchorEl.getBoundingClientRect();
        positionCardAtRect(rect);
    }

    function positionCardAtRect(rect) {
        const cardW = Math.min(340, window.innerWidth - 24);
        const cardH = Math.min(420, window.innerHeight - 24);
        let top = rect.bottom + 8;
        if (top + cardH > window.innerHeight - 12) {
            top = Math.max(12, rect.top - cardH - 8);
        }
        let left = rect.left;
        if (left + cardW > window.innerWidth - 12)
            left = window.innerWidth - cardW - 12;
        if (left < 12) left = 12;
        cardEl.style.maxWidth = cardW + "px";
        cardEl.style.maxHeight = cardH + "px";
        cardEl.style.top = top + "px";
        cardEl.style.left = left + "px";
    }

    function dismissCard() {
        if (cardEl) {
            cardEl.remove();
            cardEl = null;
            document
                .querySelectorAll(".sb-badge")
                .forEach((b) => (b.style.display = ""));
        }
    }

    function hideBadges() {
        document
            .querySelectorAll(".sb-badge")
            .forEach((b) => (b.style.display = "none"));
    }

    function onMouseUp(e) {
        setTimeout(() => {
            const sel = window.getSelection();
            const text = sel ? sel.toString().replace(/\s+/g, " ").trim() : "";
            if (text.length < 5 || text.length > 600) {
                hideSelectBtn();
                return;
            }
            if (e.target.closest(".sb-card, .sb-select-btn")) return;
            if (!sel.rangeCount || sel.getRangeAt(0).collapsed) return;
            const rect = sel.getRangeAt(0).getBoundingClientRect();
            showSelectBtn(rect, text);
        }, 10);
    }

    function showSelectBtn(rect, text) {
        hideSelectBtn();
        selectBtn = document.createElement("button");
        selectBtn.className = "sb-select-btn";
        selectBtn.textContent = "Ask Study Buddy";
        selectBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const btnRect = selectBtn.getBoundingClientRect();
            hideSelectBtn();
            window.getSelection()?.removeAllRanges();
            showAnswerCardAt(btnRect, text);
        });
        document.body.appendChild(selectBtn);
        const top = rect.bottom + 6;
        const left = Math.max(
            6,
            Math.min(rect.left, window.innerWidth - selectBtn.offsetWidth - 12),
        );
        selectBtn.style.top = top + "px";
        selectBtn.style.left = left + "px";
    }

    function hideSelectBtn() {
        if (selectBtn) {
            selectBtn.remove();
            selectBtn = null;
        }
    }

    document.addEventListener("mouseup", onMouseUp);

    function onQuestionClick(e) {
        const q = questions.find(
            (item) => item.el === e.target || item.el.contains(e.target),
        );
        if (!q) return;
        e.preventDefault();
        e.stopPropagation();
        showAnswerCard(q.el, q.text);
    }

    document.addEventListener("click", (e) => {
        if (e.target.closest(`.${HIGHLIGHT_CLASS}`)) {
            onQuestionClick(e);
            return;
        }
        if (selectBtn && !e.target.closest(".sb-select-btn")) hideSelectBtn();
        if (cardEl && !e.target.closest(".sb-card")) dismissCard();
    });

    window.addEventListener("scroll", () => {
        hideSelectBtn();
        if (cardEl) {
            const q = questions.find(
                (item) => cardEl && item.el === cardEl._anchor,
            );
            if (q) positionCard(q.el);
        }
    });

    window.addEventListener("resize", () => {
        if (cardEl && cardEl._anchor) positionCard(cardEl._anchor);
    });

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.type === "scan") {
            try {
                const found = scanQuestions();
                highlightQuestions();
                sendResponse({ ok: true, questions: found });
            } catch (err) {
                sendResponse({ ok: false, error: String(err) });
            }
            return false;
        }
        if (message.type === "clear") {
            removeHighlights();
            questions = [];
            sendResponse({ ok: true });
            return false;
        }
    });
})();