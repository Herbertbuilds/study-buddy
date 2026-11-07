// Study Buddy — renderer helpers shared by the popup and content script.
// Injected as a classic script before both popup.js and content.js, so the
// answer-markdown/HTML-escaping logic lives in exactly one place.

(() => {
    if (window.__studyBuddyShared) return;
    window.__studyBuddyShared = true;

    window.sbEscapeHtml = (s) =>
        s
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");

    window.sbRenderMarkdown = (html) =>
        html
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

    window.sbConfidenceMeta = {
        high: { label: "High confidence" },
        medium: { label: "Medium confidence" },
        low: { label: "Low confidence — double-check" },
    };
})();
