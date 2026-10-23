(() => {
    "use strict";

    const STORE_KEY = "sb_settings_v1";

    const providerList = document.getElementById("providerList");
    const scanBtn = document.getElementById("scanBtn");
    const statusText = document.getElementById("statusText");
    const themeToggle = document.getElementById("themeToggle");
    const autoScanToggle = document.getElementById("autoScanToggle");
    const indentSelect = document.getElementById("indentSelect");

    const builtInProviders = [
        { id: "mock", name: "Mock", stable: true },
        { id: "groq", name: "Groq", stable: true },
        { id: "gemini", name: "Gemini", stable: true },
        { id: "qwen", name: "Qwen", stable: true },
    ];

    function renderProviders() {
        providerList.innerHTML = "";
        for (const p of builtInProviders) {
            const row = document.createElement("div");
            row.className = "sb-provider";
            row.dataset.provider = p.id;
            row.innerHTML = `
        <div>
          <div class="sb-provider-name">${p.name}</div>
          <div class="sb-provider-status">${p.stable ? "Ready" : "Unavailable"}</div>
        </div>
      `;
            row.addEventListener("click", () => setActiveProvider(p.id));
            providerList.appendChild(row);
        }
    }

    function setActiveProvider(id) {
        chrome.storage.local.get(STORE_KEY, (res) => {
            const settings = res[STORE_KEY] || {};
            settings.provider = id;
            chrome.storage.local.set({ [STORE_KEY]: settings }, () => {
                renderProviders();
                statusText.textContent = `Provider: ${id}`;
            });
        });
    }

    function loadSettings() {
        chrome.storage.local.get(STORE_KEY, (res) => {
            const settings = res[STORE_KEY] || {};
            if (settings.provider) {
                document
                    .querySelector(
                        `.sb-provider[data-provider="${settings.provider}"]`,
                    )
                    ?.classList.add("active");
                statusText.textContent = `Provider: ${settings.provider}`;
            }
            if (typeof settings.autoScan === "boolean") {
                autoScanToggle.checked = settings.autoScan;
            }
            if (settings.indentation) {
                indentSelect.value = settings.indentation;
            }
            applyTheme(settings.theme);
        });
    }

    function applyTheme(theme) {
        const current = document.documentElement.dataset.theme || "dark";
        if (
            theme === "light" ||
            (theme === "system" &&
                window.matchMedia("(prefers-color-scheme: light)").matches)
        ) {
            document.documentElement.dataset.theme = "light";
        } else {
            document.documentElement.dataset.theme = "dark";
        }
    }

    function toggleTheme() {
        const next =
            document.documentElement.dataset.theme === "dark"
                ? "light"
                : "dark";
        document.documentElement.dataset.theme = next;
        chrome.storage.local.get(STORE_KEY, (res) => {
            const settings = res[STORE_KEY] || {};
            settings.theme = next;
            chrome.storage.local.set({ [STORE_KEY]: settings });
        });
    }

    function setStatus(message, isError = false) {
        statusText.textContent = message;
        statusText.style.color = isError ? "var(--danger)" : "var(--muted)";
    }

    scanBtn.addEventListener("click", async () => {
        setStatus("Scanning…");
        try {
            const [tab] = await chrome.tabs.query({
                active: true,
                currentWindow: true,
            });
            if (!tab) {
                setStatus("No active tab", true);
                return;
            }
            const response = await chrome.tabs.sendMessage(tab.id, {
                type: "sb:scan",
            });
            if (!response || !response.ok) {
                setStatus(
                    response && response.error ? response.error : "Scan failed",
                    true,
                );
                return;
            }
            setStatus(`Found ${response.count} question blocks`);
        } catch (err) {
            setStatus("Content script not ready", true);
        }
    });

    themeToggle.addEventListener("click", toggleTheme);

    autoScanToggle.addEventListener("change", () => {
        chrome.storage.local.get(STORE_KEY, (res) => {
            const settings = res[STORE_KEY] || {};
            settings.autoScan = autoScanToggle.checked;
            chrome.storage.local.set({ [STORE_KEY]: settings });
        });
    });

    indentSelect.addEventListener("change", () => {
        chrome.storage.local.get(STORE_KEY, (res) => {
            const settings = res[STORE_KEY] || {};
            settings.indentation = indentSelect.value;
            chrome.storage.local.set({ [STORE_KEY]: settings });
        });
    });

    renderProviders();
    loadSettings();
})();
