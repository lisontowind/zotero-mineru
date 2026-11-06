var ZoteroMineruPreferences = {
	PREF_BRANCH: "extensions.zotero-mineru.",
	initialized: false,

	FIELDS: [
		{ id: "mineru-parseLinkSourcePDF", pref: "parseLinkSourcePDF", type: "bool", defaultValue: true },
		{ id: "mineru-parseGenerateHTML", pref: "parseGenerateHTML", type: "bool" },
		{ id: "mineru-parseImageMode", pref: "parseImageMode", type: "string" },
		{ id: "mineru-translateOutputFormat", pref: "translateOutputFormat", type: "string" },
		{ id: "mineru-translateMode", pref: "translateMode", type: "string" },
		{ id: "mineru-api-base-url", pref: "apiBaseURL", type: "string" },
		{ id: "mineru-api-token", pref: "apiToken", type: "string" },
		{ id: "mineru-model-version", pref: "modelVersion", type: "string" },
		{ id: "mineru-note-include-images", pref: "noteIncludeImages", type: "bool" },
		{ id: "mineru-poll-interval-sec", pref: "pollIntervalSec", type: "int", min: 1, max: 60, label: "轮询间隔", labelEn: "Polling interval" },
		{ id: "mineru-timeout-sec", pref: "timeoutSec", type: "int", min: 5, max: 3600, label: "请求超时", labelEn: "Request timeout" },
		{ id: "mineru-note-title-prefix", pref: "noteTitlePrefix", type: "string" },
		{ id: "mineru-llm-api-base-url", pref: "llmApiBaseURL", type: "string" },
		{ id: "mineru-llm-api-key", pref: "llmApiKey", type: "string" },
		{ id: "mineru-llm-model", pref: "llmModel", type: "string" },
		{ id: "mineru-summary-language", pref: "summaryLanguage", type: "string" },
		{ id: "mineru-summary-prompt", pref: "summaryPrompt", type: "string" },
		{ id: "mineru-summary-request-json", pref: "summaryRequestJSON", type: "string" },
		{ id: "mineru-translate-language", pref: "translateLanguage", type: "string" },
		{ id: "mineru-translate-chunk-size", pref: "translateChunkSize", type: "int", min: 5000, max: 60000, label: "翻译分段字符数", labelEn: "Translation chunk size" },
		{ id: "mineru-translate-concurrency", pref: "translateConcurrency", type: "int", min: 1, max: 8, label: "翻译并发请求数", labelEn: "Translation concurrency" },
		{ id: "mineru-translate-retry-count", pref: "translateRetryCount", type: "int", min: 1, max: 5, label: "翻译自动重试次数", labelEn: "Translation auto-retry count" },
		{ id: "mineru-translate-request-json", pref: "translateRequestJSON", type: "string" }
	],

	createAbortController() {
		let AC = typeof AbortController !== "undefined" ? AbortController : null;
		if (!AC && typeof window !== "undefined" && window.AbortController) {
			AC = window.AbortController;
		}
		if (!AC && typeof globalThis !== "undefined" && globalThis.AbortController) {
			AC = globalThis.AbortController;
		}
		if (!AC) {
			let win = (typeof Zotero !== "undefined" && (Zotero.getMainWindow?.() || Zotero.getMainWindows?.()?.[0]))
				|| (typeof Services !== "undefined" && (Services.wm?.getMostRecentWindow?.("navigator:browser") || Services.wm?.getMostRecentWindow?.(null)));
			if (win && win.AbortController) {
				AC = win.AbortController;
			}
		}
		if (AC) {
			return new AC();
		}
		let error = new Error(this.isEnglishLocale()
			? "AbortController is unavailable. Open a Zotero main window and retry."
			: "无法创建 AbortController，请打开 Zotero 主窗口后重试。");
		error.code = "ABORT_CONTROLLER_UNAVAILABLE";
		error.retryable = false;
		throw error;
	},

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

	parseOptionalJSONObject(rawValue, fieldLabel) {
		let normalized = String(rawValue || "").trim();
		if (!normalized) return {};
		let parsed;
		try {
			parsed = JSON.parse(normalized);
		}
		catch (e) {
			let msg = this.isEnglishLocale()
				? `${fieldLabel} is not valid JSON: ${e.message || e}`
				: `${fieldLabel} 不是合法 JSON：${e.message || e}`;
			throw new Error(msg);
		}
		if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
			let msg = this.isEnglishLocale()
				? `${fieldLabel} must be a JSON object`
				: `${fieldLabel} 必须是 JSON 对象`;
			throw new Error(msg);
		}
		return parsed;
	},

	mergeRequestPayload(basePayload, extraPayload, reservedKeys = []) {
		let mergedPayload = { ...basePayload };
		if (!extraPayload || typeof extraPayload !== "object") {
			return mergedPayload;
		}
		for (let [key, value] of Object.entries(extraPayload)) {
			if (reservedKeys.includes(key)) {
				let msg = this.isEnglishLocale()
					? `Extra JSON parameters cannot override reserved fields: ${reservedKeys.join(", ")}`
					: `额外 JSON 参数不能覆盖保留字段：${reservedKeys.join(", ")}`;
				throw new Error(msg);
			}
			mergedPayload[key] = value;
		}
		return mergedPayload;
	},

	loadSettings() {
		for (let field of this.FIELDS) {
			let input = this.$(field.id);
			if (!input) continue;
			let value = Zotero.Prefs.get(this.PREF_BRANCH + field.pref, true);
			if (field.pref === "apiToken" && (!value || !String(value).trim())) {
				value = Zotero.Prefs.get(this.PREF_BRANCH + "apiKey", true) || "";
			}
			if (value === undefined || value === null) value = field.defaultValue ?? "";
			if (field.type === "bool") {
				input.checked = !!value;
			} else {
				input.value = String(value);
			}
		}
		this.syncTranslationMode();
		this.setStatus("");
	},

	saveSettings({ silent = false } = {}) {
		this.syncTranslationMode();
		let pending = [];
		let invalid = (input, message) => {
			input.setAttribute?.("aria-invalid", "true");
			this.setStatus(message, true);
			if (!silent) input.focus?.();
			return false;
		};
		for (let field of this.FIELDS) {
			let input = this.$(field.id);
			if (!input) continue;
			input.removeAttribute?.("aria-invalid");
			let value = field.type === "bool" ? !!input.checked : input.value;
			if (field.type === "bool") {
				pending.push([field.pref, value]);
				continue;
			}
			if (field.type === "int") {
				let intValue = Number(value);
				if (!/^\d+$/.test(String(value).trim()) || !Number.isSafeInteger(intValue)
					|| intValue < field.min || intValue > field.max) {
					let fieldLabel = this.isEnglishLocale() && field.labelEn ? field.labelEn : field.label;
					let msg = this.isEnglishLocale()
						? `${fieldLabel} must be an integer between ${field.min} and ${field.max}`
						: `${fieldLabel}必须是 ${field.min}–${field.max} 之间的整数`;
					return invalid(input, msg);
				}
				pending.push([field.pref, intValue]);
				continue;
			}
			if (["summaryRequestJSON", "translateRequestJSON"].includes(field.pref)) {
				try {
					let fieldLabel = field.pref === "summaryRequestJSON"
						? (this.isEnglishLocale() ? "Summary extra JSON parameters" : "总结额外 JSON 参数")
						: (this.isEnglishLocale() ? "Translation extra JSON parameters" : "翻译额外 JSON 参数");
					let params = this.parseOptionalJSONObject(value, fieldLabel);
					this.mergeRequestPayload({}, params, ["model", "messages"]);
				}
				catch (e) {
					return invalid(input, e.message || String(e));
				}
			}
			value = String(value).trim();
			if (["apiToken", "llmApiKey"].includes(field.pref)) {
				value = value.replace(/^Bearer\s+/i, "").trim();
			}
			pending.push([field.pref, value]);
		}
		for (let [pref, value] of pending) {
			Zotero.Prefs.set(this.PREF_BRANCH + pref, value, true);
		}
		this.setStatus(silent ? "" : (this.isEnglishLocale() ? "Saved" : "已保存"));
		return true;
	},

	syncTranslationMode() {
		let format = this.$("mineru-translateOutputFormat");
		let mode = this.$("mineru-translateMode");
		let bilingual = this.$("mineru-bilingual-option");
		if (!format || !mode) return;
		let enabled = format.value === "html";
		if (bilingual) bilingual.disabled = !enabled;
		mode.disabled = !enabled;
		let images = this.$("mineru-parseImageMode");
		if (images) images.disabled = !this.$("mineru-parseGenerateHTML")?.checked;
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
		if (!this.saveSettings({ silent: true })) return;
		let settings = this.readCurrentSettings();
		if (!settings.apiToken) {
			this.setStatus(this.isEnglishLocale() ? "Test failed: Token is empty" : "测试失败：Token 为空", true);
			this.setOutput(this.isEnglishLocale() ? "Please enter API Token first." : "请先填写 API Token。");
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

		let timeoutID;
		try {
			let controller = this.createAbortController();
			timeoutID = setTimeout(() => controller.abort(), settings.timeoutMS);
			this.setStatus(this.isEnglishLocale() ? "Testing MinerU connection..." : "正在测试 MinerU 连接...");
			this.setOutput(`POST ${endpoint}\n${this.isEnglishLocale() ? "Token length" : "Token长度"}: ${settings.apiToken.length}`);

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
				this.setStatus(this.isEnglishLocale() ? "Test failed: Token invalid or insufficient permissions" : "测试失败：Token 无效或权限不足", true);
				this.setOutput(`HTTP ${response.status}\n${text.slice(0, 1200)}`);
				return;
			}
			if (!response.ok) {
				this.setStatus(this.isEnglishLocale() ? `Test failed: HTTP ${response.status}` : `测试失败：HTTP ${response.status}`, true);
				this.setOutput(text.slice(0, 1200));
				return;
			}

			if (json && json.code === 0) {
				this.setStatus(this.isEnglishLocale() ? "MinerU connection successful: Token is valid" : "MinerU 连接成功：Token 可用");
				this.setOutput(JSON.stringify({
					endpoint,
					code: json.code,
					msg: json.msg || "",
					batch_id: json?.data?.batch_id || null
				}, null, 2));
				return;
			}

			this.setStatus(this.isEnglishLocale() ? "Connected, but API returned business error" : "已连通，但接口返回业务错误", true);
			this.setOutput((json ? JSON.stringify(json, null, 2) : text).slice(0, 1200));
		}
		catch (e) {
			let isTimeout = e?.name === "AbortError";
			let msg = isTimeout
				? (this.isEnglishLocale() ? "Request timed out" : "请求超时")
				: (e.message || String(e));
			let prefix = this.isEnglishLocale() ? "Test failed: " : "测试失败：";
			this.setStatus(prefix + msg, true);
			this.setOutput(msg);
		}
		finally {
			clearTimeout(timeoutID);
		}
	},

	readLLMSettings() {
		let apiBaseURL = (Zotero.Prefs.get(this.PREF_BRANCH + "llmApiBaseURL", true) || "").trim();
		let apiKey = (Zotero.Prefs.get(this.PREF_BRANCH + "llmApiKey", true) || "").trim();
		apiKey = apiKey.replace(/^Bearer\s+/i, "");
		let model = (Zotero.Prefs.get(this.PREF_BRANCH + "llmModel", true) || "").trim();
		let summaryRequestJSON = (Zotero.Prefs.get(this.PREF_BRANCH + "summaryRequestJSON", true) || "").trim();
		let translateRequestJSON = (Zotero.Prefs.get(this.PREF_BRANCH + "translateRequestJSON", true) || "").trim();
		return { apiBaseURL, apiKey, model, summaryRequestJSON, translateRequestJSON };
	},

	buildLLMURL(apiBaseURL) {
		let clean = String(apiBaseURL || "").trim();
		if (!clean) return "";
		let url = new URL(clean);
		let path = url.pathname.replace(/\/+$/, "");
		if (!/\/chat\/completions$/i.test(path)) {
			path += "/chat/completions";
		}
		url.pathname = path;
		return url.href;
	},

	parseSSEResponse(text) {
		let isEn = this.isEnglishLocale();
		let incomplete = (detail) => {
			let error = new Error(isEn ? "LLM stream incomplete: " + detail : "LLM 流式响应不完整：" + detail);
			error.code = "LLM_INCOMPLETE";
			return error;
		};
		let fullContent = "", lastModel = "", lastFinishReason = null;
		let dataLines = [], eventName = "", sawData = false, done = false;
		let consumeEvent = () => {
			let type = eventName;
			eventName = "";
			if (!dataLines.length) return;
			let data = dataLines.join("\n").trim();
			dataLines = [];
			if (!data) return;
			sawData = true;
			if (done) throw incomplete("data after [DONE]");
			if (data === "[DONE]") {
				done = true;
				return;
			}
			if (type === "error") throw incomplete(data.slice(0, 200));
			let chunk;
			try { chunk = JSON.parse(data); }
			catch (_) { throw incomplete("invalid JSON event"); }
			if (!chunk || typeof chunk !== "object") throw incomplete("invalid event");
			if (chunk.error) throw incomplete(chunk.error.message || String(chunk.error));
			if (chunk.model) lastModel = chunk.model;
			let choice = chunk.choices?.find(item => item.index === undefined || item.index === 0);
			if (!choice) return; // Usage-only events and other completion choices carry no text for choice 0.
			if (choice.finish_reason) lastFinishReason = choice.finish_reason;
			let delta = choice.delta?.content ?? choice.text ?? "";
			if (typeof delta === "string") {
				fullContent += delta;
			} else if (Array.isArray(delta)) {
				fullContent += delta.map(part => typeof part === "string" ? part : part?.text || "").join("");
			}
		};
		for (let line of String(text || "").split(/\r\n|\r|\n/)) {
			if (!line) {
				consumeEvent();
			} else if (line.startsWith("data:")) {
				dataLines.push(line.slice(5).replace(/^ /, ""));
			} else if (line.startsWith("event:")) {
				eventName = line.slice(6).trim();
			}
		}
		consumeEvent();
		if (!sawData) return null;
		if (!done && !lastFinishReason) throw incomplete("missing finish_reason or [DONE]");
		return {
			model: lastModel,
			choices: [{
				finish_reason: lastFinishReason || "stop",
				message: { role: "assistant", content: fullContent.trim() }
			}]
		};
	},
	getLLMResponseContent(result) {
		let choice = result?.choices?.[0];
		let candidate = result?.candidates?.[0];
		let reason = choice?.finish_reason ?? candidate?.finishReason ?? result?.done_reason;
		let normReason = String(reason || "").toLowerCase();
		let isComplete = result?.done !== false
			&& (!reason || ["stop", "end_turn", "stop_sequence"].includes(normReason));
		if (!isComplete) {
			let isEn = typeof this.isEnglishLocale === "function" && this.isEnglishLocale();
			let error = new Error(["length", "max_tokens"].includes(normReason)
				? (isEn ? "LLM output was truncated. Please adjust max tokens." : "LLM 输出被截断，未保存为完整结果。请减小翻译分段或调整模型输出上限后重试。")
				: (isEn ? `LLM response incomplete (${reason}).` : `LLM 未完整完成回复（${reason}），未保存为完整结果。`));
			error.code = "LLM_INCOMPLETE";
			throw error;
		}
		let content = choice?.message?.content;
		if (Array.isArray(content)) {
			content = content.map(part => typeof part === "string" ? part : part?.text || "").join("");
		}
		if (typeof content !== "string" || !content.trim()) {
			if (typeof choice?.text === "string" && choice.text.trim()) {
				content = choice.text;
			} else if (typeof result?.response === "string" && result.response.trim()) {
				content = result.response;
			} else if (Array.isArray(candidate?.content?.parts)) {
				content = candidate.content.parts.filter(part => !part?.thought)
					.map(part => typeof part?.text === "string" ? part.text : "").join("");
			}
		}
		if (typeof content === "string") {
			// Only a leading reasoning prefix is metadata. Tags inside prose,
			// Markdown code or JSON strings belong to the document.
			content = content.trim().replace(/^(?:<think>[\s\S]*?<\/think>\s*)+/i, "").trim();
		}
		if (typeof content !== "string" || !content.trim()) {
			let isEn = typeof this.isEnglishLocale === "function" && this.isEnglishLocale();
			throw new Error(isEn ? "LLM returned empty or invalid response" : "LLM 返回内容为空或格式无效");
		}
		return content.trim();
	},

	async sendLLMTestRequest({ endpoint, apiKey, payload, timeoutMS = 30000 }) {
		let controller = this.createAbortController();
		let timeoutID = setTimeout(() => controller.abort(), timeoutMS);
		try {
			let response = await fetch(endpoint, {
				method: "POST",
				headers: {
					"Accept": "application/json",
					"Content-Type": "application/json",
					"Authorization": "Bearer " + apiKey
				},
				body: JSON.stringify(payload),
				signal: controller.signal
			});

			let text = await response.text();
			let isEn = typeof this.isEnglishLocale === "function" && this.isEnglishLocale();
			text = String(text || "").replace(/^\uFEFF/, "").trim();

			if (response.status === 401 || response.status === 403) {
				throw new Error(isEn
					? `API Key invalid or insufficient permissions (HTTP ${response.status})`
					: `API Key 无效或权限不足（HTTP ${response.status}）`);
			}
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
			}

			let json = null;
			try {
				json = JSON.parse(text);
			}
			catch (_e) {
				let fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
				if (fenceMatch) {
					try { json = JSON.parse(fenceMatch[1].trim()); } catch (_) {}
				}
				if (!json && typeof this.parseSSEResponse === "function") {
					json = this.parseSSEResponse(text);
				}
			}

			if (!json && (text.startsWith("<") || /<html|<!DOCTYPE/i.test(text))) {
				let preview = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
				throw new Error(isEn
					? `LLM API returned HTML instead of JSON: ${preview || "HTML response"}. Please check API Base URL.`
					: `LLM API 返回了 HTML 网页而非 JSON 数据：${preview || "HTML 页面"}。请检查 Base URL 是否正确。`);
			}

			let reply = this.getLLMResponseContent(json);

			return {
				model: json?.model || payload.model,
				reply: reply.trim(),
				usage: json?.usage || null
			};
		}
		catch (e) {
			if (e?.name === "AbortError") {
				let isEn = typeof this.isEnglishLocale === "function" && this.isEnglishLocale();
				throw new Error(isEn
					? `Request timed out (${Math.round(timeoutMS / 1000)}s)`
					: `请求超时（${Math.round(timeoutMS / 1000)}秒）`);
			}
			throw e;
		}
		finally {
			clearTimeout(timeoutID);
		}
	},

	async testLLMConnection() {
		if (!this.saveSettings()) return;
		let llm = this.readLLMSettings();
		let isEn = typeof this.isEnglishLocale === "function" && this.isEnglishLocale();
		if (!llm.apiBaseURL || !llm.apiKey || !llm.model) {
			this.setStatus(isEn ? "Test failed: Incomplete LLM settings" : "测试失败：LLM 设置不完整", true);
			this.setOutput(isEn
				? "Please enter LLM API Base URL, API Key, and Model Name first."
				: "请先填写 LLM API Base URL、API Key 和模型名称。");
			return;
		}

		let endpoint = this.buildLLMURL(llm.apiBaseURL);
		try {
			let summaryRequestParams = this.parseOptionalJSONObject(
				llm.summaryRequestJSON,
				isEn ? "Summary extra JSON parameters" : "总结额外 JSON 参数"
			);
			let translateRequestParams = this.parseOptionalJSONObject(
				llm.translateRequestJSON,
				isEn ? "Translation extra JSON parameters" : "翻译额外 JSON 参数"
			);
			let testCases = [
				{
					label: "summary",
					description: "总结配置",
					extraParams: summaryRequestParams,
					payload: {
						model: llm.model,
						messages: [
							{ role: "system", content: "You are testing the current summary request configuration. Reply with exactly OK." },
							{ role: "user", content: "Return exactly OK." }
						],
						max_tokens: 16,
						stream: false
					}
				},
				{
					label: "translation",
					description: "翻译配置",
					extraParams: translateRequestParams,
					payload: {
						model: llm.model,
						messages: [
							{ role: "system", content: "You are testing the current translation request configuration. Reply with exactly OK." },
							{ role: "user", content: "Return exactly OK." }
						],
						max_tokens: 16,
						stream: false
					}
				}
			];

			this.setStatus(this.isEnglishLocale() ? "Testing current LLM configuration..." : "正在测试当前 LLM 配置...");
			this.setOutput(JSON.stringify({
				endpoint,
				model: llm.model,
				keyLength: llm.apiKey.length,
				tests: testCases.map((testCase) => ({
					type: testCase.label,
					extraParams: testCase.extraParams
				}))
			}, null, 2));

			let results = [];
			let failures = [];
			for (let testCase of testCases) {
				let payload = this.mergeRequestPayload(
					testCase.payload,
					testCase.extraParams,
					["model", "messages"]
				);
				try {
					let result = await this.sendLLMTestRequest({
						endpoint,
						apiKey: llm.apiKey,
						payload
					});
					results.push({
						type: testCase.label,
						status: "ok",
						model: result.model,
						reply: result.reply,
						usage: result.usage,
						extraParams: testCase.extraParams
					});
				}
				catch (e) {
					failures.push({
						type: testCase.label,
						error: e.message || String(e),
						extraParams: testCase.extraParams
					});
				}
			}

			if (failures.length) {
				this.setStatus(this.isEnglishLocale() ? "Current LLM configuration test failed" : "当前 LLM 配置测试失败", true);
				this.setOutput(JSON.stringify({
					endpoint,
					model: llm.model,
					successes: results,
					failures
				}, null, 2));
				return;
			}

			this.setStatus(this.isEnglishLocale() ? "Current LLM configuration test succeeded" : "当前 LLM 配置测试成功");
			this.setOutput(JSON.stringify({
				endpoint,
				model: llm.model,
				results
			}, null, 2));
		}
		catch (e) {
			let msg = e.message || String(e);
			let prefix = this.isEnglishLocale() ? "LLM test failed: " : "LLM 测试失败：";
			this.setStatus(prefix + msg, true);
			this.setOutput(msg);
		}
	},

	isEnglishLocale() {
		try {
			let loc = (typeof Zotero !== "undefined" && Zotero.locale)
				|| (typeof Services !== "undefined" && Services.locale?.appLocaleAsBCP47)
				|| "";
			if (!loc) return false;
			return !loc.toLowerCase().startsWith("zh");
		} catch (_) {
			return false;
		}
	},

	applyLocalization() {
		if (!this.isEnglishLocale()) return;
		const dict = {
			"mineru-pref-title": "MinerU PDF Parsing Settings",
			"mineru-pref-api-base-url": "API Base URL",
			"mineru-pref-api-token": "API Token",
			"mineru-pref-api-token-input": { placeholder: "Token generated from MinerU console" },
			"mineru-pref-model-version": "Model Version",
			"mineru-pref-parse-generate-html": "Also generate HTML (always keep Markdown)",
			"mineru-pref-parse-markdown-help": "Original Markdown is always saved in the attachment directory. When unchecked, Markdown is displayed directly as the main Zotero attachment. When HTML is checked, HTML is the main attachment; right-click and open the enclosing folder to view the .md file. AI summary and translation always use the original Markdown.",
			"mineru-pref-parse-image-mode": "HTML Image Storage",
			"mineru-pref-image-mode-folder": { label: "Separate images folder" },
			"mineru-pref-image-mode-inline": { label: "Inline Base64 (single file)" },
			"mineru-pref-parse-link-source-pdf": "Automatically link source PDF with parsed attachment",
			"mineru-pref-related-help": "Enabled by default. Creates a two-way Related Item link between the source PDF and generated Markdown or HTML attachment. Only affects future parses; disabling will not remove existing links or retroactively link past attachments.",
			"mineru-pref-note-include-images": "Include images when converting to note",
			"mineru-pref-poll-interval-sec": "Polling Interval (seconds)",
			"mineru-pref-timeout-sec": "Request Timeout (seconds)",
			"mineru-pref-note-title-prefix": "Note Title Prefix",
			"mineru-pref-llm-heading": "LLM Settings (AI Summary / Translation)",
			"mineru-pref-llm-api-base-url": "LLM API Base URL",
			"mineru-pref-llm-api-key": "LLM API Key",
			"mineru-pref-llm-model": "LLM Model Name",
			"mineru-pref-summary-language": "Summary Language",
			"mineru-pref-summary-prompt": "AI Summary Prompt",
			"mineru-pref-summary-prompt-textarea": { placeholder: "e.g. Please summarize the research problem, methodology, key findings, and limitations in {{language}}." },
			"mineru-pref-summary-prompt-help": "Leave blank to use default summary prompt. Setting a prompt replaces the default system prompt. {{language}} will be replaced with the chosen summary language, and paper text is attached automatically. Clear and save to restore default.",
			"mineru-pref-summary-request-json": "Summary Extra JSON Parameters",
			"mineru-pref-translate-output-format": "Translation Output Format",
			"mineru-pref-translate-format-html": { label: "Standalone HTML" },
			"mineru-pref-translate-mode": "Translation Mode",
			"mineru-pref-translate-mode-translation": { label: "Translation only" },
			"mineru-pref-bilingual-option": { label: "Bilingual side-by-side columns (HTML only)" },
			"mineru-pref-translate-language": "Translation Target Language",
			"mineru-pref-translate-chunk-size": "Translation Chunk Size (characters)",
			"mineru-pref-translate-concurrency": "Translation Concurrency",
			"mineru-pref-translate-retry-count": "Translation Auto-Retry Count",
			"mineru-pref-translate-request-json": "Translation Extra JSON Parameters",
			"mineru-pref-save-button": "Save",
			"mineru-pref-test-button": "Test MinerU Connection",
			"mineru-pref-test-llm-button": "Test LLM Configuration",
			"mineru-pref-bottom-help": "Parsing and translation allow choosing Markdown / HTML and image storage independently. Bilingual side-by-side is only supported in HTML; switching to Markdown reverts to translation only. Embedded images in Markdown depend on reader support. Extracted images are located in the attachment's images folder; existing attachments are not automatically converted."
		};
		for (let [id, val] of Object.entries(dict)) {
			let el = typeof document !== "undefined" && document.querySelector ? document.querySelector(`[data-l10n-id="${id}"]`) : null;
			if (!el) continue;
			if (typeof val === "string") {
				el.textContent = val;
			} else if (typeof val === "object") {
				if (val.placeholder) el.placeholder = val.placeholder;
				if (val.label) {
					el.setAttribute?.("label", val.label);
					if (el.label !== undefined) el.label = val.label;
				}
			}
		}
	},

	init() {
		if (this.initialized) return;
		try {
			if (typeof window !== "undefined") {
				window.MozXULElement?.insertFTLIfNeeded?.("zotero-mineru.ftl");
			}
			this.applyLocalization();
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
			let testLLMButton = this.$("mineru-test-llm-button");
			if (testLLMButton) {
				testLLMButton.addEventListener("click", () => {
					this.testLLMConnection().catch((e) => {
						Zotero.logError(e);
						this.setStatus(`LLM 测试失败: ${e.message || e}`, true);
					});
				});
			}
			for (let field of this.FIELDS) {
				let input = this.$(field.id);
				if (!input) continue;
				let saveSilently = () => this.saveSettings({ silent: true });
				if (input.localName === "menulist") {
					input.addEventListener("command", saveSilently);
				}
				else {
					input.addEventListener("change", saveSilently);
					input.addEventListener("input", saveSilently);
				}
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
