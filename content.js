(() => {
    "use strict";

    // Lightweight scanner shell for the current page.
    // Real scan logic is added in later commits; this commit just wires up
    // the content script surface and a no-op scan entry point.

    let highlighted = [];

    function clearHighlights() {
        highlighted.forEach((el) => el.classList.remove("sb-highlighted"));
        highlighted = [];
        document.querySelectorAll(".sb-select-btn").forEach((b) => b.remove());
    }

    window.__sbScan = function scan() {
        clearHighlights();
        const questions = findQuestionsOnPage();
        highlighted = questions.map((node) => {
            node.classList.add("sb-highlighted");
            return node;
        });
        return { count: questions.length, questions };
    };

    function findQuestionsOnPage() {
        // Placeholder selector strategy for later refinement.
        return Array.from(
            document.querySelectorAll(
                ".question, .q-text, [class*='question'], ul li",
            ),
        ).filter((node) => node.textContent.trim().length > 0);
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
            clearHighlights();
            sendResponse({ ok: true });
            return true;
        }
        return false;
    });
})();
