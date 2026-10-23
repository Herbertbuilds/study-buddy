(() => {
    "use strict";

    let highlighted = [];
    let selectButtons = [];

    function cleanup() {
        highlighted.forEach((el) => el.classList.remove("sb-highlighted"));
        selectButtons.forEach((b) => b.remove());
        highlighted = [];
        selectButtons = [];
    }

    function detachButtons() {
        selectButtons.forEach((b) => b.remove());
        selectButtons = [];
    }

    window.__sbScan = function scan() {
        cleanup();
        const questions = findQuestionsOnPage();
        highlighted = questions.map((node) => {
            node.classList.add("sb-highlighted");
            return node;
        });
        renderNumbers();
        return { count: questions.length, questions };
    };

    function renderNumbers() {
        detachButtons();
        highlighted.forEach((node, idx) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "sb-select-btn";
            btn.textContent = String(idx + 1);
            btn.addEventListener("click", () => openCard(node));
            document.body.appendChild(btn);
            selectButtons.push(btn);
        });
    }

    function findQuestionsOnPage() {
        const candidates = document.querySelectorAll(
            ".question, .q-text, [class*='question'], ul li, p",
        );
        const out = [];
        for (const node of candidates) {
            if (!node.textContent.trim()) continue;
            if (node.closest(".sb-card")) continue;
            out.push(node);
        }
        return out.slice(0, 80);
    }

    function openCard(node) {
        const question = node.textContent.trim().slice(0, 400);
        const card = document.createElement("div");
        card.className = "sb-card";
        card.innerHTML = `
      <div class="sb-card-head">
        <span class="sb-card-title">Study Buddy</span>
        <button type="button" class="sb-card-close" aria-label="Close">×</button>
      </div>
      <div class="sb-card-question">${escapeHtml(question)}</div>
      <div class="sb-card-body">
        <div class="sb-card-confidence sb-confidence-high">High</div>
        <div class="sb-card-answer">
          <p>Answer placeholder for this question block.</p>
          <p>Real answer logic is wired in later commits.</p>
        </div>
      </div>
    `;
        card.querySelector(".sb-card-close").addEventListener("click", () =>
            card.remove(),
        );
        document.body.appendChild(card);
    }

    function escapeHtml(text) {
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === "sb:scan") {
            try {
                const result = window.__sbScan();
                sendResponse({ ok: true, ...result });
            } catch (err) {
                sendResponse({ ok: false, error: String(err) });
            }
            return true;
        }
        if (msg.type === "sb:clear") {
            cleanup();
            sendResponse({ ok: true });
            return true;
        }
        return false;
    });

    chrome.runtime.onMessage.addListener(function () {
        return true;
    });
})();
