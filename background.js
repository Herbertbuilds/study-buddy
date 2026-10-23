(() => {
    "use strict";

    const STORE_KEY = "sb_settings_v1";

    chrome.runtime.onInstalled.addListener(() => {
        const defaults = {
            theme: "system",
            autoScan: false,
            provider: "mock",
            indentation: "smart",
        };
        chrome.storage.local.get(STORE_KEY, (res) => {
            if (!res[STORE_KEY]) {
                chrome.storage.local.set({ [STORE_KEY]: defaults });
            }
        });
    });

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === "sb:getSettings") {
            chrome.storage.local.get(STORE_KEY, (res) => {
                sendResponse({ ok: true, settings: res[STORE_KEY] || null });
            });
            return true;
        }
        if (msg.type === "sb:setSettings") {
            chrome.storage.local.set({ [STORE_KEY]: msg.settings }, () => {
                sendResponse({ ok: true });
            });
            return true;
        }
        return false;
    });
})();
