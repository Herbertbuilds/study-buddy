// Study Buddy — offscreen document.
// MV3 service workers can't use dynamic import(), which pdf.js needs, and
// they have no DOM. PDF extraction therefore lives here, in a hidden page,
// and the background service worker just forwards scan requests.

let pdfjsLib = null;

async function getPdfJs() {
    if (!pdfjsLib) {
        pdfjsLib = await import(
            chrome.runtime.getURL("vendor/pdfjs/pdf.min.mjs")
        );
        pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(
            "vendor/pdfjs/pdf.worker.min.mjs",
        );
    }
    return pdfjsLib;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== "pdf:getText") return false;
    extractPdfText(message.url)
        .then((text) => sendResponse({ ok: true, text }))
        .catch((err) =>
            sendResponse({ ok: false, error: String(err?.message || err) }),
        );
    return true;
});

async function extractPdfText(url) {
    const pdfjs = await getPdfJs();
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(
            `Could not download the document (HTTP ${res.status}).`,
        );
    const data = await res.arrayBuffer();
    const doc = await pdfjs.getDocument({ data }).promise;
    const maxPages = Math.min(doc.numPages, 80);
    const pages = [];
    for (let i = 1; i <= maxPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => item.str).join(" "));
    }
    const text = pages.join("\n\n");
    if (!text.trim()) {
        throw new Error(
            "This document has no extractable text — it may be a scanned image. Try a text-based PDF.",
        );
    }
    return text;
}
