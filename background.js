(() => {
    "use strict";

    const STORE_KEY = "sb_settings_v1";
    const COMMAND_ID = "scan-this-page";

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
        if (msg.type === "sb:commandAck") {
            sendResponse({ ok: true });
            return false;
        }
        return false;
    });

    chrome.commands.onCommand.addListener((command) => {
        if (command !== COMMAND_ID) return;
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs[0];
            if (!tab) return;
            chrome.tabs.sendMessage(tab.id, { type: "sb:scan" }, () => {
                if (chrome.runtime.lastError) {
                    chrome.tabs.sendMessage(tab.id, { type: "sb:clear" });
                }
            });
        });
    });
})();
