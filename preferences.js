var ZoteroMineruPreferences = {
	PREF_BRANCH: "extensions.zotero-mineru.",
	initialized: false,

	FIELDS: [
		{ id: "mineru-api-base-url", pref: "apiBaseURL", type: "string" },
		{ id: "mineru-api-token", pref: "apiToken", type: "string" },
		{ id: "mineru-model-version", pref: "modelVersion", type: "string" },
		{ id: "mineru-poll-interval-sec", pref: "pollIntervalSec", type: "int" },
		{ id: "mineru-timeout-sec", pref: "timeoutSec", type: "int" },
		{ id: "mineru-note-title-prefix", pref: "noteTitlePrefix", type: "string" }
	],

	$(id) {
		return document.getElementById(id);
	},

	setOutput(message) {
		let output = this.$("mineru-test-output");
		if (!output) return;
		output.textContent = message || "";
	},

	setStatus(message, isError = false) {
		let status = this.$("mineru-status");
		if (!status) return;
		status.textContent = message || "";
		status.style.color = isError ? "#b03232" : "#1d6e36";
	},

	loadSettings() {
		for (let field of this.FIELDS) {
			let input = this.$(field.id);
			if (!input) continue;
			let value = Zotero.Prefs.get(this.PREF_BRANCH + field.pref, true);
			if (field.pref === "apiToken" && (!value || !String(value).trim())) {
				value = Zotero.Prefs.get(this.PREF_BRANCH + "apiKey", true) || "";
			}
			if (value === undefined || value === null) value = "";
			input.value = String(value);
		}
		this.setStatus("");
	},

	saveSettings({ silent = false } = {}) {
		for (let field of this.FIELDS) {
			let input = this.$(field.id);
			if (!input) continue;
			let value = input.value;
			if (field.type === "int") {
				let intValue = parseInt(value, 10);
				if (!Number.isFinite(intValue) || intValue <= 0) {
					if (!silent) {
						this.setStatus("数值字段必须是正整数", true);
					}
					return;
				}
				Zotero.Prefs.set(this.PREF_BRANCH + field.pref, intValue, true);
				continue;
			}
			if (field.pref === "apiToken") {
				value = value.replace(/^Bearer\s+/i, "");
			}
			Zotero.Prefs.set(this.PREF_BRANCH + field.pref, value.trim(), true);
		}
		if (!silent) {
			this.setStatus("已保存");
		}
	},

	readCurrentSettings() {
		let apiBaseURL = (Zotero.Prefs.get(this.PREF_BRANCH + "apiBaseURL", true) || "").trim();
		if (!apiBaseURL) {
			apiBaseURL = "https://mineru.net/api/v4";
		}
		apiBaseURL = apiBaseURL.replace(/\/+$/, "");

		let apiToken = (Zotero.Prefs.get(this.PREF_BRANCH + "apiToken", true) || "").trim();
		if (!apiToken) {
			apiToken = (Zotero.Prefs.get(this.PREF_BRANCH + "apiKey", true) || "").trim();
		}
		apiToken = apiToken.replace(/^Bearer\s+/i, "");

		let timeoutSec = parseInt(Zotero.Prefs.get(this.PREF_BRANCH + "timeoutSec", true), 10);
		if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) timeoutSec = 120;

		let modelVersion = (Zotero.Prefs.get(this.PREF_BRANCH + "modelVersion", true) || "pipeline").trim();
		if (!["vlm", "pipeline"].includes(modelVersion)) {
			modelVersion = "pipeline";
		}

		return {
			apiBaseURL,
			apiToken,
			timeoutMS: timeoutSec * 1000,
			modelVersion
		};
	},

	async testConnection() {
		this.saveSettings({ silent: true });
		let settings = this.readCurrentSettings();
		if (!settings.apiToken) {
			this.setStatus("测试失败：Token 为空", true);
			this.setOutput("请先填写 API Token。");
			return;
		}

		let endpoint = settings.apiBaseURL + "/file-urls/batch";
		let payload = {
			model_version: settings.modelVersion,
			files: [
				{
					name: "connectivity-test.pdf",
					data_id: "zotero-connect-test-" + Date.now()
				}
			]
		};

		let controller = new AbortController();
		let timeoutID = setTimeout(() => controller.abort(), settings.timeoutMS);
		try {
			this.setStatus("正在测试连接...");
			this.setOutput(`POST ${endpoint}\nToken长度: ${settings.apiToken.length}`);

			let response = await fetch(endpoint, {
				method: "POST",
				headers: {
					"Accept": "application/json",
					"Content-Type": "application/json",
					"Authorization": "Bearer " + settings.apiToken
				},
				body: JSON.stringify(payload),
				signal: controller.signal
			});

			let text = await response.text();
			let json = null;
			try {
				json = JSON.parse(text);
			}
			catch (_e) {}

			if (response.status === 401 || response.status === 403) {
				this.setStatus("测试失败：Token 无效或权限不足", true);
				this.setOutput(`HTTP ${response.status}\n${text.slice(0, 1200)}`);
				return;
			}
			if (!response.ok) {
				this.setStatus(`测试失败：HTTP ${response.status}`, true);
				this.setOutput(text.slice(0, 1200));
				return;
			}

			if (json && json.code === 0) {
				this.setStatus("连接成功：Token 可用");
				this.setOutput(JSON.stringify({
					endpoint,
					code: json.code,
					msg: json.msg || "",
					batch_id: json?.data?.batch_id || null
				}, null, 2));
				return;
			}

			this.setStatus("已连通，但接口返回业务错误", true);
			this.setOutput((json ? JSON.stringify(json, null, 2) : text).slice(0, 1200));
		}
		catch (e) {
			let msg = e?.name === "AbortError" ? "请求超时" : (e.message || String(e));
			this.setStatus("测试失败：" + msg, true);
			this.setOutput(msg);
		}
		finally {
			clearTimeout(timeoutID);
		}
	},

	init() {
		if (this.initialized) return;
		try {
			this.loadSettings();
			let saveButton = this.$("mineru-save-button");
			if (saveButton) {
				saveButton.addEventListener("click", () => this.saveSettings());
			}
			let testButton = this.$("mineru-test-button");
			if (testButton) {
				testButton.addEventListener("click", () => {
					this.testConnection().catch((e) => {
						Zotero.logError(e);
						this.setStatus(`测试失败: ${e.message || e}`, true);
					});
				});
			}
			for (let field of this.FIELDS) {
				let input = this.$(field.id);
				if (!input) continue;
				input.addEventListener("change", () => this.saveSettings({ silent: true }));
				input.addEventListener("input", () => this.saveSettings({ silent: true }));
			}
			this.initialized = true;
		}
		catch (e) {
			Zotero.logError(e);
			this.setStatus(`设置页初始化失败: ${e.message || e}`, true);
		}
	}
};

if (typeof window !== "undefined") {
	window.ZoteroMineruPreferences = ZoteroMineruPreferences;
	window.addEventListener("DOMContentLoaded", () => {
		if (document.getElementById("zotero-mineru-prefpane")) {
			ZoteroMineruPreferences.init();
		}
	}, { once: true });
}
