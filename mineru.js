ZoteroMineru = {
	id: null,
	version: null,
	rootURI: null,
	initialized: false,
	menuRegistered: false,
	popupListeners: new WeakMap(),
	
	PREF_BRANCH: "extensions.zotero-mineru.",
	ROOT_MENU_ID: "zotero-mineru-menu",
	CONTEXT_MENU_ID: "zotero-mineru-parse-pdf",
	SUMMARY_MENU_ID: "zotero-mineru-ai-summary",
	TRANSLATE_MENU_ID: "zotero-mineru-ai-translate",
	
	init({ id, version, rootURI }) {
		if (this.initialized) return;
		this.id = id;
		this.version = version;
		this.rootURI = rootURI;
		this.initialized = true;
	},
	
	log(msg) {
		Zotero.debug("Zotero MinerU: " + msg);
	},

	getMenuIconURL() {
		if (this.rootURI) {
			return this.rootURI + "icon16.svg";
		}
		return "icon16.svg";
	},

	supportsMenuManager() {
		return !!Zotero.MenuManager?.registerMenu;
	},

	getContextMenuDefinitions() {
		return [
			{
				id: this.CONTEXT_MENU_ID,
				label: "使用 MinerU 解析 PDF 并保存为 Markdown",
				l10nID: "zotero-mineru-menu-parse-pdf",
				getTasks: (selectedItems) => this.collectPDFTasks(selectedItems),
				run: ({ window, selectedItems }) => this.handleParseCommand({ window, selectedItems }),
				errorPrefix: "执行失败"
			},
			{
				id: this.SUMMARY_MENU_ID,
				label: "使用 AI 总结文献",
				l10nID: "zotero-mineru-menu-ai-summary",
				getTasks: (selectedItems) => this.collectSummaryTasks(selectedItems),
				run: ({ window, selectedItems }) => this.handleSummaryCommand({ window, selectedItems }),
				errorPrefix: "AI 总结失败"
			},
			{
				id: this.TRANSLATE_MENU_ID,
				label: "使用 AI 翻译文献",
				l10nID: "zotero-mineru-menu-ai-translate",
				getTasks: (selectedItems) => this.collectTranslateTasks(selectedItems),
				run: ({ window, selectedItems }) => this.handleTranslateCommand({ window, selectedItems }),
				errorPrefix: "AI 翻译失败"
			}
		];
	},

	runContextMenuCommand(definition, { window, selectedItems }) {
		definition.run({ window, selectedItems }).catch((e) => {
			this.log(`${definition.id} command failed: ${e}`);
			Zotero.logError(e);
			this.showAlert(window, "MinerU", `${definition.errorPrefix}: ${e.message || e}`);
		});
	},

	registerMenuForZotero8() {
		if (!this.supportsMenuManager() || this.menuRegistered) return false;
		try {
			let iconURL = this.getMenuIconURL();
			let menuDefinitions = this.getContextMenuDefinitions();
			Zotero.MenuManager.registerMenu({
				menuID: this.ROOT_MENU_ID,
				pluginID: this.id,
				target: "main/library/item",
				menus: [
					{
						menuType: "submenu",
						label: "MinerU",
						l10nID: "zotero-mineru-menu-root",
						icon: iconURL,
						iconURL,
						image: iconURL,
						menus: menuDefinitions.map((definition) => ({
							menuType: "menuitem",
							label: definition.label,
							l10nID: definition.l10nID,
							icon: iconURL,
							iconURL,
							image: iconURL,
							onShowing: (_event, context) => {
								if (typeof context?.setEnabled === "function") {
									let selectedItems = Array.isArray(context?.items) ? context.items : [];
									context.setEnabled(definition.getTasks(selectedItems).length > 0);
								}
							},
							onCommand: (_event, context) => {
								let window = context?.menuElem?.ownerGlobal
									|| Zotero.getMainWindows?.()?.[0]
									|| null;
								let selectedItems = Array.isArray(context?.items) ? context.items : null;
								this.runContextMenuCommand(definition, { window, selectedItems });
							}
						}))
					}
				]
			});
			this.menuRegistered = true;
			return true;
		}
		catch (e) {
			this.log(`Failed to register menu via MenuManager: ${e}`);
			Zotero.logError(e);
			return false;
		}
	},
	
	addToWindow(window) {
		window.ZoteroMineru = this;
		window.MozXULElement?.insertFTLIfNeeded?.("zotero-mineru.ftl");
		if (this.menuRegistered) {
			return;
		}
		let doc = window.document;
		let popup = doc.getElementById("zotero-itemmenu")
			|| doc.getElementById("item-tree-context-menu")
			|| doc.getElementById("zotero-item-tree-menu");
		if (!popup) {
			this.log("Item context menu not found in this window");
			return;
		}
		if (doc.getElementById(this.ROOT_MENU_ID)) return;
		let iconURL = this.getMenuIconURL();
		let menuDefinitions = this.getContextMenuDefinitions();
		
		let rootMenu = doc.createXULElement("menu");
		rootMenu.id = this.ROOT_MENU_ID;
		rootMenu.setAttribute("label", "MinerU");
		rootMenu.setAttribute("class", "menu-iconic");
		rootMenu.setAttribute("image", iconURL);
		rootMenu.style.listStyleImage = `url("${iconURL}")`;
		let subPopup = doc.createXULElement("menupopup");
		rootMenu.appendChild(subPopup);
		let menuItems = [];
		for (let definition of menuDefinitions) {
			let menuitem = doc.createXULElement("menuitem");
			menuitem.id = definition.id;
			menuitem.setAttribute("label", definition.label);
			menuitem.setAttribute("class", "menuitem-iconic");
			menuitem.setAttribute("image", iconURL);
			menuitem.style.listStyleImage = `url("${iconURL}")`;
			menuitem.addEventListener("command", () => {
				this.runContextMenuCommand(definition, { window, selectedItems: null });
			});
			subPopup.appendChild(menuitem);
			menuItems.push({ definition, menuitem });
		}
		popup.appendChild(rootMenu);

		let onPopupShowing = () => {
			let selectedItems = window.ZoteroPane?.getSelectedItems?.() || [];
			let hasEnabledChild = false;
			for (let { definition, menuitem } of menuItems) {
				let hasTasks = definition.getTasks(selectedItems).length > 0;
				menuitem.disabled = !hasTasks;
				hasEnabledChild ||= hasTasks;
			}
			rootMenu.disabled = !hasEnabledChild;
		};
		popup.addEventListener("popupshowing", onPopupShowing);
		this.popupListeners.set(window, { popup, onPopupShowing });
	},
	
	addToAllWindows() {
		let windows = Zotero.getMainWindows();
		if (this.supportsMenuManager() && this.registerMenuForZotero8()) {
			for (let win of windows) {
				if (!win.ZoteroPane) continue;
				this.addToWindow(win);
			}
			return;
		}
		for (let win of windows) {
			if (!win.ZoteroPane) continue;
			this.addToWindow(win);
		}
	},
	
	removeFromWindow(window) {
		if (window.ZoteroMineru === this) {
			try {
				delete window.ZoteroMineru;
			}
			catch (_e) {}
		}
		let doc = window.document;
		doc.getElementById(this.ROOT_MENU_ID)?.remove();
		doc.getElementById(this.CONTEXT_MENU_ID)?.remove();
		doc.getElementById(this.SUMMARY_MENU_ID)?.remove();
		doc.getElementById(this.TRANSLATE_MENU_ID)?.remove();
		let listenerData = this.popupListeners.get(window);
		if (listenerData) {
			listenerData.popup.removeEventListener("popupshowing", listenerData.onPopupShowing);
			this.popupListeners.delete(window);
		}
	},
	
	removeFromAllWindows() {
		if (this.supportsMenuManager() && this.menuRegistered) {
			try {
				Zotero.MenuManager.unregisterMenu(this.ROOT_MENU_ID);
			}
			catch (e) {
				this.log(`Failed to unregister menu: ${e}`);
				Zotero.logError(e);
			}
			this.menuRegistered = false;
		}
		let windows = Zotero.getMainWindows();
		for (let win of windows) {
			if (!win.ZoteroPane) continue;
			this.removeFromWindow(win);
		}
	},
	
	getSettings() {
		let apiBaseURL = (Zotero.Prefs.get(this.PREF_BRANCH + "apiBaseURL", true) || "").trim();
		apiBaseURL = apiBaseURL.replace(/\/+$/, "");
		if (!apiBaseURL) {
			apiBaseURL = "https://mineru.net/api/v4";
		}
		
		let timeoutSec = parseInt(
			Zotero.Prefs.get(this.PREF_BRANCH + "timeoutSec", true),
			10
		);
		if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) {
			timeoutSec = 120;
		}
		
		let pollIntervalSec = parseInt(
			Zotero.Prefs.get(this.PREF_BRANCH + "pollIntervalSec", true),
			10
		);
		if (!Number.isFinite(pollIntervalSec) || pollIntervalSec <= 0) {
			pollIntervalSec = 3;
		}
		
		let modelVersion = (Zotero.Prefs.get(this.PREF_BRANCH + "modelVersion", true) || "pipeline").trim();
		if (!["pipeline", "vlm"].includes(modelVersion)) {
			modelVersion = "pipeline";
		}
		
		let apiToken = (Zotero.Prefs.get(this.PREF_BRANCH + "apiToken", true) || "").trim();
		if (!apiToken) {
			apiToken = (Zotero.Prefs.get(this.PREF_BRANCH + "apiKey", true) || "").trim();
		}
		apiToken = apiToken.replace(/^Bearer\s+/i, "");
		
		return {
			apiBaseURL,
			apiToken,
			modelVersion,
			pollIntervalMS: pollIntervalSec * 1000,
			timeoutMS: timeoutSec * 1000,
			noteTitlePrefix: (Zotero.Prefs.get(this.PREF_BRANCH + "noteTitlePrefix", true) || "MinerU Parse").trim()
		};
	},
	
	parentHasNoteWithTag(parentItem, tagName) {
		if (!parentItem) return false;
		let noteIDs = parentItem.getNotes();
		for (let noteID of noteIDs) {
			let noteItem = Zotero.Items.get(noteID);
			if (!noteItem) continue;
			let tags = noteItem.getTags();
			if (tags.some((t) => t.tag === tagName)) return true;
		}
		return false;
	},

	parentHasAttachmentWithTag(parentItem, tagName) {
		if (!parentItem) return false
		let attachmentIDs = parentItem.getAttachments()
		for (let attachmentID of attachmentIDs) {
			let attachmentItem = Zotero.Items.get(attachmentID)
			if (!attachmentItem) continue
			let tags = attachmentItem.getTags()
			if (tags.some((t) => t.tag === tagName)) return true
		}
		return false
	},

	collectPDFTasks(selectedItems) {
		let tasks = [];
		let seenAttachmentIDs = new Set();

		let addTask = (attachment, parentItem) => {
			if (!attachment || seenAttachmentIDs.has(attachment.id)) return;
			if (!attachment.isPDFAttachment()) return;
			if (parentItem && (this.parentHasNoteWithTag(parentItem, "#MinerU-Parse") || this.parentHasAttachmentWithTag(parentItem, "#MinerU-Parse"))) return;
			seenAttachmentIDs.add(attachment.id);
			tasks.push({ attachment, parentItem });
		};

		for (let item of selectedItems) {
			if (item.isPDFAttachment()) {
				let parentItem = item.parentItemID ? Zotero.Items.get(item.parentItemID) : null;
				addTask(item, parentItem);
				continue;
			}
			if (!item.isRegularItem()) continue;

			let attachmentIDs = item.getAttachments();
			for (let attachmentID of attachmentIDs) {
				let attachment = Zotero.Items.get(attachmentID);
				addTask(attachment, item);
			}
		}

		return tasks;
	},
	
	showAlert(window, title, message) {
		if (window) {
			Zotero.alert(window, title, message);
			return;
		}
		this.log(`${title}: ${message}`);
	},

	showConfirm(window, title, message) {
		try {
			if (typeof Services !== "undefined" && Services.prompt?.confirm) {
				return Services.prompt.confirm(window || null, title, message);
			}
		}
		catch (e) {
			Zotero.logError(e);
		}
		if (window?.confirm) {
			return window.confirm(message);
		}
		this.log(`${title}: ${message}`);
		return false;
	},

	async handleParseCommand({ window = null, selectedItems = null } = {}) {
		let settings = this.getSettings();
		if (!settings.apiToken) {
			this.showAlert(window, "MinerU", "请先在设置中填写 MinerU 官方 API Token。");
			return;
		}
		
		let items = selectedItems
			|| window?.ZoteroPane?.getSelectedItems?.()
			|| [];
		let tasks = this.collectPDFTasks(items);
		if (!tasks.length) {
			this.showAlert(window, "MinerU", "当前选择里没有可解析的 PDF 附件。");
			return;
		}
		
		let progress = new Zotero.ProgressWindow({ closeOnClick: true });
		progress.changeHeadline("MinerU PDF 解析");
		progress.show();
		
		let successes = 0;
		let failures = [];
		
		for (let task of tasks) {
			let title = task.attachment.getField("title") || this.fileNameFromPath(task.attachment.getFilePath() || "");
			let itemProgress = new progress.ItemProgress(
				"chrome://zotero/skin/treeitem-attachment-pdf.png",
				title
			);
			let updateItemStatus = ({ text = "", percent = null } = {}) => {
				let label = text ? `${title}（${text}）` : title;
				if (typeof itemProgress.setText === "function") {
					itemProgress.setText(label);
				}
				if (Number.isFinite(percent)) {
					itemProgress.setProgress(percent);
				}
			};
			try {
				updateItemStatus({
					text: "准备解析",
					percent: 5
				});
					let parsedResult = await this.parseAttachmentWithMineru(task.attachment, settings, {
						onStatus: (statusInfo) => {
							updateItemStatus({
								text: statusInfo?.displayText || statusInfo?.phase || "处理中",
								percent: statusInfo?.progress ?? null
							});
					}
				});
				updateItemStatus({
					text: "保存 Markdown",
					percent: 85
				});
					await this.saveResultAsMarkdownAttachment({
						attachment: task.attachment,
						parentItem: task.parentItem,
						parsedResult,
						settings
					});
				updateItemStatus({
					text: "完成",
					percent: 100
				});
				successes++;
			}
			catch (e) {
				updateItemStatus({ text: "失败" });
				itemProgress.setError();
				failures.push(`${title}: ${e.message || e}`);
				Zotero.logError(e);
			}
		}
		
		progress.addDescription(`完成 ${successes}/${tasks.length}`);
		progress.startCloseTimer(5000);
		
		if (failures.length) {
			this.showAlert(window, "MinerU 部分失败", failures.slice(0, 10).join("\n"));
		}
	},
	
	reportParseStatus(statusContext, updates = {}) {
		if (!statusContext) return;
		Object.assign(statusContext, updates);
		if (typeof statusContext.onStatus !== "function") return;
		statusContext.onStatus({
			phase: statusContext.phase || "",
			mineruState: statusContext.mineruState || "",
			progress: statusContext.progress ?? null,
			displayText: this.describeParseStatus(statusContext)
		});
	},

	describeParseStatus(statusContext) {
		if (!statusContext) return "";
		let phase = (statusContext.phase || "").trim();
		let mineruState = (statusContext.mineruState || "").trim();
		if (phase && mineruState) {
			return `${phase}，MinerU 状态: ${mineruState}`;
		}
		if (phase) {
			return phase;
		}
		if (mineruState) {
			return `MinerU 状态: ${mineruState}`;
		}
		return "";
	},

	wrapErrorWithParseStatus(error, statusContext) {
		if (error instanceof Error && error.message.includes("当前状态:")) {
			return error;
		}
		let baseMessage = error instanceof Error ? error.message : String(error);
		let statusText = this.describeParseStatus(statusContext);
		if (!statusText) {
			return error instanceof Error ? error : new Error(baseMessage);
		}
		let wrapped = new Error(`${baseMessage}（当前状态: ${statusText}）`);
		wrapped.cause = error;
		return wrapped;
	},

	async parseAttachmentWithMineru(attachment, settings, options = {}) {
		let statusContext = {
			phase: "准备解析",
			mineruState: "",
			progress: 5,
			onStatus: options.onStatus
		};
		this.reportParseStatus(statusContext);

		try {
			this.reportParseStatus(statusContext, {
				phase: "读取本地 PDF",
				progress: 10
			});
			let filePath = attachment.getFilePath();
			if (!filePath) {
				throw new Error("附件文件不存在或尚未下载到本地");
			}
			
			let fileBytes = await IOUtils.read(filePath);
			let fileName = this.fileNameFromPath(filePath);

			let dataID = this.makeDataID(attachment.id);
			let uploadPayload = {
				model_version: settings.modelVersion,
				files: [
					{
						name: fileName,
						data_id: dataID
					}
				]
			};
			
			this.reportParseStatus(statusContext, {
				phase: "申请上传地址",
				progress: 20
			});
			let applyUploadResult = await this.requestMineruJSON({
				url: `${settings.apiBaseURL}/file-urls/batch`,
				token: settings.apiToken,
				method: "POST",
				body: uploadPayload
			});
			if (applyUploadResult.code !== 0) {
				throw new Error(`申请上传地址失败: ${applyUploadResult.msg || "unknown error"}`);
			}
			
			let batchID = applyUploadResult?.data?.batch_id;
			let uploadURL = applyUploadResult?.data?.file_urls?.[0];
			if (!batchID || !uploadURL) {
				throw new Error("官方 API 未返回 batch_id 或 upload_url");
			}
			
			this.reportParseStatus(statusContext, {
				phase: "上传 PDF",
				progress: 35
			});
			let uploadResponse = await fetch(uploadURL, {
				method: "PUT",
				body: fileBytes
			});
			if (!uploadResponse.ok) {
				let errText = await uploadResponse.text();
				throw new Error(`上传 PDF 失败 ${uploadResponse.status}: ${errText.slice(0, 300)}`);
			}
			
			this.reportParseStatus(statusContext, {
				phase: "等待 MinerU 解析",
				progress: 55
			});
			let result = await this.pollMineruExtractResult({
				apiBaseURL: settings.apiBaseURL,
				token: settings.apiToken,
				batchID,
				dataID,
				timeoutMS: settings.timeoutMS,
				pollIntervalMS: settings.pollIntervalMS,
				statusContext
			});
			
			let zipURL = result?.full_zip_url;
			if (!zipURL) {
				throw new Error("解析已完成，但未返回 full_zip_url");
			}
			
			this.reportParseStatus(statusContext, {
				phase: "下载解析结果",
				progress: 75
			});
			let zipBytes = await this.downloadParseResultZip({
				zipURL,
				apiBaseURL: settings.apiBaseURL,
				token: settings.apiToken,
				statusContext
			});
			
			this.reportParseStatus(statusContext, {
				phase: "提取 Markdown",
				progress: 90
			});
			let parsedResult = await this.extractNoteContentFromMineruZip(zipBytes, fileName);
			this.reportParseStatus(statusContext, {
				phase: "提取完成",
				progress: 95
			});
			return parsedResult;
		}
		catch (e) {
			throw this.wrapErrorWithParseStatus(e, statusContext);
		}
	},
	
	makeDataID(attachmentID) {
		let suffix = Math.random().toString(36).slice(2, 10);
		return `zotero-${attachmentID}-${suffix}`;
	},

	normalizeDownloadURL(downloadURL, apiBaseURL) {
		let raw = (downloadURL || "").toString().trim();
		if (!raw) {
			throw new Error("下载链接为空");
		}
		if (raw.startsWith("//")) {
			raw = `https:${raw}`;
		}
		let normalized;
		try {
			normalized = new URL(raw, `${apiBaseURL}/`);
		}
		catch (_e) {
			throw new Error(`下载链接格式非法: ${raw.slice(0, 200)}`);
		}
		if (!["http:", "https:"].includes(normalized.protocol)) {
			throw new Error(`下载链接协议不支持: ${normalized.protocol}`);
		}
		return normalized.toString();
	},

	maskURLForError(rawURL) {
		try {
			let parsed = new URL(rawURL);
			return `${parsed.origin}${parsed.pathname}`;
		}
		catch (_e) {
			return (rawURL || "").toString().slice(0, 200);
		}
	},

	async fetchZipWithOptions({ url, token, withAuth }) {
		let headers = new Headers();
		if (withAuth && token) {
			headers.set("Authorization", `Bearer ${token}`);
		}
		return await fetch(url, {
			method: "GET",
			headers
		});
	},

	async downloadParseResultZip({ zipURL, apiBaseURL, token, statusContext = null }) {
		let normalizedURL = this.normalizeDownloadURL(zipURL, apiBaseURL);
		let candidates = [];
		let addCandidate = (url, withAuth, label) => {
			let key = `${url}|${withAuth ? "auth" : "anon"}`;
			if (candidates.some((item) => item.key === key)) return;
			candidates.push({
				key,
				url,
				withAuth,
				label
			});
		};

		addCandidate(normalizedURL, false, "直连下载");
		addCandidate(normalizedURL, true, "直连下载（Bearer）");
		if (normalizedURL.startsWith("http://")) {
			let httpsURL = `https://${normalizedURL.slice("http://".length)}`;
			addCandidate(httpsURL, false, "HTTPS 回退");
			addCandidate(httpsURL, true, "HTTPS 回退（Bearer）");
		}

		let failures = [];
		for (let i = 0; i < candidates.length; i++) {
			let attempt = candidates[i];
			this.reportParseStatus(statusContext, {
				phase: `下载解析结果（${attempt.label}，${i + 1}/${candidates.length}）`,
				progress: 75
			});
			try {
				let response = await this.fetchZipWithOptions({
					url: attempt.url,
					token,
					withAuth: attempt.withAuth
				});
				if (!response.ok) {
					let errText = await response.text();
					failures.push(`${attempt.label}: HTTP ${response.status}`);
					if (i < candidates.length - 1) {
						continue;
					}
					throw new Error(`下载解析结果失败 ${response.status}: ${errText.slice(0, 300)}`);
				}
				return new Uint8Array(await response.arrayBuffer());
			}
			catch (e) {
				let message = e?.message || String(e);
				failures.push(`${attempt.label}: ${message}`);
				if (i < candidates.length - 1) {
					continue;
				}
			}
		}

		let urlHint = this.maskURLForError(normalizedURL);
		let reason = failures.length ? failures[failures.length - 1] : "unknown";
		throw new Error(`下载解析结果网络失败 (${urlHint})：${reason}`);
	},
		
	async requestMineruJSON({ url, token, method = "GET", body = null }) {
		let headers = new Headers({
			"Accept": "application/json",
			"Authorization": `Bearer ${token}`
		});
		let requestOptions = {
			method,
			headers
		};
		if (body !== null) {
			headers.set("Content-Type", "application/json");
			requestOptions.body = JSON.stringify(body);
		}
		
		let response = await fetch(url, requestOptions);
		let responseText = await response.text();
		if (!response.ok) {
			throw new Error(`官方 API 请求失败 ${response.status}: ${responseText.slice(0, 500)}`);
		}
		
		try {
			return JSON.parse(responseText);
		}
		catch (_e) {
			throw new Error(`官方 API 返回的 JSON 无法解析: ${responseText.slice(0, 500)}`);
		}
	},
	
	async pollMineruExtractResult({ apiBaseURL, token, batchID, dataID, timeoutMS, pollIntervalMS, statusContext = null }) {
		let startTime = Date.now();
		let lastState = "";
		while (Date.now() - startTime < timeoutMS) {
			let statusResult = await this.requestMineruJSON({
				url: `${apiBaseURL}/extract-results/batch/${encodeURIComponent(batchID)}`,
				token
			});
			if (statusResult.code !== 0) {
				throw new Error(`查询解析状态失败: ${statusResult.msg || "unknown error"}`);
			}
			
			let extractResults = statusResult?.data?.extract_result || [];
			let result = extractResults.find((x) => x?.data_id === dataID) || extractResults[0];
			if (result?.state) {
				lastState = result.state;
				this.reportParseStatus(statusContext, {
					mineruState: lastState
				});
			}
			
			if (result?.state === "done") {
				return result;
			}
			if (result?.state === "failed") {
				throw new Error(result.err_msg || "MinerU 解析失败");
			}
			
			await Zotero.Promise.delay(pollIntervalMS);
		}
		throw new Error(`MinerU 解析超时，最后状态: ${lastState || "unknown"}`);
	},
	
	async extractNoteContentFromMineruZip(zipBytes, originalFileName) {
		let tempDir = PathUtils.join(PathUtils.tempDir, `zotero-mineru-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
		let zipPath = PathUtils.join(tempDir, "result.zip");
		
		await IOUtils.makeDirectory(tempDir, { createAncestors: true });
		await IOUtils.write(zipPath, zipBytes);
		
		let zipReader = Components.classes["@mozilla.org/libjar/zip-reader;1"]
			.createInstance(Components.interfaces.nsIZipReader);
		try {
			zipReader.open(this.pathToNSIFile(zipPath));
			let markdownEntryName = this.pickMarkdownEntry(zipReader, originalFileName);
			if (!markdownEntryName) {
				throw new Error("结果 ZIP 中没有找到 Markdown 文件");
			}

			let markdownBytes = await this.readZipEntryBytes(zipReader, tempDir, markdownEntryName);
			let markdownText = new TextDecoder("utf-8").decode(markdownBytes);
			let entryMap = this.buildArchiveEntryMap(zipReader);
			let inlinedResult = await this.inlineArchiveImagesInMarkdown({
				markdownText,
				markdownEntryName: markdownEntryName,
				zipReader,
				tempDir,
				entryMap
			});
			let rendered = await this.markdownToHTML(inlinedResult.markdownText);
			return {
				sourceKind: "markdown",
				rawMarkdownText: markdownText,
				rawMarkdownEntryName: markdownEntryName || "",
				markdownText: inlinedResult.markdownText,
				contentHTML: rendered.html,
				embeddedImageCount: inlinedResult.embeddedImages.length,
				embeddedImages: inlinedResult.embeddedImages
			};
		}
		finally {
			try {
				zipReader.close();
			}
			catch (_e) {}
			await IOUtils.remove(zipPath).catch(() => {});
			await IOUtils.remove(tempDir).catch(() => {});
		}
	},

	buildArchiveEntryMap(zipReader) {
		let map = new Map();
		let enumerator = zipReader.findEntries(null);
		while (enumerator.hasMore()) {
			let entryName = enumerator.getNext();
			if (!entryName || entryName.endsWith("/")) continue;
			let normalized = this.normalizeArchivePath(entryName);
			if (!normalized) continue;
			map.set(normalized.toLowerCase(), entryName);
		}
		return map;
	},

	async readZipEntryBytes(zipReader, tempDir, entryName) {
		let safeName = this.fileNameFromPath(entryName).replace(/[^\w.\-]+/g, "_");
		let outputPath = PathUtils.join(
			tempDir,
			`entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`
		);
		let outputFile = this.pathToNSIFile(outputPath, true);
		zipReader.extract(entryName, outputFile);
		try {
			return new Uint8Array(await IOUtils.read(outputPath));
		}
		finally {
			await IOUtils.remove(outputPath).catch(() => {});
		}
	},

	async inlineArchiveImagesInMarkdown({ markdownText, markdownEntryName, zipReader, tempDir, entryMap }) {
		let embeddedByEntry = new Map();
		let embeddedImages = [];
		let addEmbedded = (entryName, mimeType, bytes) => {
			let cacheKey = entryName.toLowerCase();
			if (embeddedByEntry.has(cacheKey)) {
				return embeddedByEntry.get(cacheKey);
			}
			let id = `img-${embeddedImages.length + 1}`;
			let marker = `zotero-mineru-image://${id}`;
			let dataURI = `data:${mimeType};base64,${this.bytesToBase64(bytes)}`;
			let imageData = {
				id,
				marker,
				entryName,
				fileName: this.fileNameFromPath(entryName),
				mimeType,
				bytes,
				dataURI
			};
			embeddedImages.push(imageData);
			embeddedByEntry.set(cacheKey, imageData);
			return imageData;
		};

		let replacedText = await this.replaceAsync(
			markdownText,
			/!\[([^\]]*)\]\(([^)]+)\)/g,
			async (match) => {
				let alt = match[1] || "";
				let targetInfo = this.parseMarkdownImageTarget(match[2] || "");
				let imageData = await this.resolveArchiveImageReference({
					resourceURL: targetInfo.url,
					markdownEntryName,
					entryMap,
					zipReader,
					tempDir,
					embeddedByEntry,
					addEmbedded
				});
				if (!imageData) return match[0];
				let titlePart = targetInfo.title ? ` "${targetInfo.title}"` : "";
				return `![${alt}](${imageData.marker}${titlePart})`;
			}
		);

		replacedText = await this.replaceAsync(
			replacedText,
			/<img\b([^>]*?)\bsrc=(["'])([^"']+)\2([^>]*)>/gi,
				async (match) => {
					let before = match[1] || "";
					let quote = match[2] || "\"";
					let src = match[3] || "";
					let after = match[4] || "";
					let imageData = await this.resolveArchiveImageReference({
						resourceURL: src,
						markdownEntryName,
					entryMap,
					zipReader,
					tempDir,
					embeddedByEntry,
					addEmbedded
				});
					if (!imageData) return match[0];
					return `<img${before}src=${quote}${imageData.marker}${quote}${after}>`;
				}
			);

		return {
			markdownText: replacedText,
			embeddedImages
		};
	},

	async replaceAsync(text, regex, asyncReplacer) {
		let output = "";
		let lastIndex = 0;
		regex.lastIndex = 0;
		let match;
		while ((match = regex.exec(text)) !== null) {
			output += text.slice(lastIndex, match.index);
			output += await asyncReplacer(match);
			lastIndex = regex.lastIndex;
			if (match[0].length === 0) {
				regex.lastIndex++;
			}
		}
		output += text.slice(lastIndex);
		return output;
	},

	parseMarkdownImageTarget(rawTarget) {
		let target = String(rawTarget || "").trim();
		if (!target) {
			return { url: "", title: "" };
		}
		if (target.startsWith("<")) {
			let closeIndex = target.indexOf(">");
			if (closeIndex > 0) {
				let url = target.slice(1, closeIndex).trim();
				let title = target.slice(closeIndex + 1).trim().replace(/^["']|["']$/g, "");
				return { url, title };
			}
		}
		let firstWhitespace = target.search(/\s/);
		let url = firstWhitespace >= 0 ? target.slice(0, firstWhitespace) : target;
		let title = firstWhitespace >= 0 ? target.slice(firstWhitespace + 1).trim() : "";
		title = title.replace(/^["']|["']$/g, "");
		return { url, title };
	},

	normalizeArchiveReference(resourceURL) {
		let value = String(resourceURL || "").trim();
		if (!value) return "";
		if (value.startsWith("<") && value.endsWith(">")) {
			value = value.slice(1, -1);
		}
		let hashIndex = value.indexOf("#");
		if (hashIndex >= 0) {
			value = value.slice(0, hashIndex);
		}
		let queryIndex = value.indexOf("?");
		if (queryIndex >= 0) {
			value = value.slice(0, queryIndex);
		}
		value = value.replace(/\\/g, "/");
		try {
			value = decodeURIComponent(value);
		}
		catch (_e) {}
		return value.trim();
	},

	resolveArchiveReference(markdownEntryName, resourceURL) {
		let normalizedRef = this.normalizeArchiveReference(resourceURL);
		if (!normalizedRef || this.isExternalResourceURL(normalizedRef)) return "";
		let baseDir = "";
		let slashIndex = markdownEntryName.lastIndexOf("/");
		if (slashIndex >= 0) {
			baseDir = markdownEntryName.slice(0, slashIndex + 1);
		}
		let merged = normalizedRef.startsWith("/")
			? normalizedRef.slice(1)
			: `${baseDir}${normalizedRef}`;
		return this.normalizeArchivePath(merged);
	},

	normalizeArchivePath(pathValue) {
		let parts = String(pathValue || "").replace(/\\/g, "/").split("/");
		let normalizedParts = [];
		for (let part of parts) {
			if (!part || part === ".") continue;
			if (part === "..") {
				if (normalizedParts.length) {
					normalizedParts.pop();
				}
				continue;
			}
			normalizedParts.push(part);
		}
		return normalizedParts.join("/");
	},

	isExternalResourceURL(resourceURL) {
		return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(resourceURL);
	},

	async resolveArchiveImageReference({
		resourceURL,
		markdownEntryName,
		entryMap,
		zipReader,
		tempDir,
		embeddedByEntry,
		addEmbedded
	}) {
		let normalizedPath = this.resolveArchiveReference(markdownEntryName, resourceURL);
		if (!normalizedPath) return null;
		let entryName = entryMap.get(normalizedPath.toLowerCase());
		if (!entryName) return null;
		let mimeType = this.guessMimeType(entryName);
		if (!mimeType.startsWith("image/")) return null;
		let cacheKey = entryName.toLowerCase();
		if (embeddedByEntry.has(cacheKey)) {
			return embeddedByEntry.get(cacheKey);
		}
		let bytes = await this.readZipEntryBytes(zipReader, tempDir, entryName);
		return addEmbedded(entryName, mimeType, bytes);
	},

	guessMimeType(pathValue) {
		let lower = String(pathValue || "").toLowerCase();
		if (lower.endsWith(".png")) return "image/png";
		if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
		if (lower.endsWith(".gif")) return "image/gif";
		if (lower.endsWith(".webp")) return "image/webp";
		if (lower.endsWith(".bmp")) return "image/bmp";
		if (lower.endsWith(".svg")) return "image/svg+xml";
		if (lower.endsWith(".tif") || lower.endsWith(".tiff")) return "image/tiff";
		return "application/octet-stream";
	},

	bytesToBase64(bytes) {
		let binary = "";
		let chunkSize = 0x8000;
		for (let i = 0; i < bytes.length; i += chunkSize) {
			let chunk = bytes.subarray(i, i + chunkSize);
			binary += String.fromCharCode.apply(null, chunk);
		}
		if (typeof btoa !== "function") {
			throw new Error("当前环境不支持 btoa，无法内嵌图片资源");
		}
		return btoa(binary);
	},

	async markdownToHTML(markdownText) {
		let markdown = String(markdownText || "");
		let fallbackHTML = this.convertMarkdownToBasicHTML(markdown);
		let convertedHTML = await this.convertMarkdownWithZoteroEngines(markdown);
		if (convertedHTML && this.looksLikeHTML(convertedHTML)) {
			if (!this.containsLikelyUnparsedMathOrTables(convertedHTML)) {
				return {
					html: convertedHTML,
					usedMarkdownEngine: true
				};
			}
			this.log("Markdown engine output still contains raw math/table markdown; using built-in parser fallback");
			return {
				html: fallbackHTML,
				usedMarkdownEngine: false
			};
		}
		return {
			html: fallbackHTML,
			usedMarkdownEngine: false
		};
	},

	looksLikeHTML(value) {
		return /<[^>]+>/.test(String(value || ""));
	},

	containsLikelyUnparsedMathOrTables(value) {
		let text = String(value || "");
		if (!text) return false;
		// Better Notes-style math output no longer contains raw "$...$" text.
		if (/\$\$[\s\S]*?\$\$/.test(text)) return true;
		if (/(^|[^$])\$[^$\n]+\$([^$]|$)/.test(text)) return true;
		// A markdown table often appears as multiple <p>|...|</p> lines when unparsed.
		if (/<p>\s*\|[^<\n]+\|\s*<\/p>/i.test(text)) return true;
		return false;
	},

	async convertMarkdownWithZoteroEngines(markdownText) {
		let candidates = [
			{ scope: Zotero?.EditorInstanceUtilities, fnName: "md2html" },
			{ scope: Zotero?.EditorInstanceUtilities, fnName: "markdownToHTML" },
			{ scope: Zotero?.EditorInstanceUtilities, fnName: "markdown2html" },
			{ scope: Zotero?.Utilities?.Internal, fnName: "md2html" },
			{ scope: Zotero?.Utilities, fnName: "markdownToHTML" }
		];
		for (let candidate of candidates) {
			let fn = candidate?.scope?.[candidate.fnName];
			if (typeof fn !== "function") continue;
			try {
				let result = fn.call(candidate.scope, markdownText);
				if (result && typeof result.then === "function") {
					result = await result;
				}
				let normalizedHTML = this.normalizeConvertedHTML(result);
				if (normalizedHTML) {
					return normalizedHTML;
				}
			}
			catch (e) {
				this.log(`Markdown converter ${candidate.fnName} failed: ${e}`);
			}
		}
		return "";
	},

	normalizeConvertedHTML(value) {
		if (!value) return "";
		if (typeof value === "string") {
			return value.trim();
		}
		if (typeof value?.html === "string") {
			return value.html.trim();
		}
		if (typeof value?.content === "string") {
			return value.content.trim();
		}
		if (typeof value?.result === "string") {
			return value.result.trim();
		}
		return "";
	},

	convertMarkdownToBasicHTML(markdownText) {
		let text = String(markdownText || "").replace(/\r\n?/g, "\n");
		let lines = text.split("\n");
		let htmlParts = [];
		let paragraph = [];
		let listType = "";
		let inCodeBlock = false;
		let codeBlockLines = [];
		let codeLanguage = "";
		let flushParagraph = () => {
			if (!paragraph.length) return;
			let paragraphHTML = paragraph
				.map((line) => this.renderInlineMarkdown(line))
				.join("<br/>");
			htmlParts.push(`<p>${paragraphHTML}</p>`);
			paragraph = [];
		};
		let closeList = () => {
			if (!listType) return;
			htmlParts.push(listType === "ol" ? "</ol>" : "</ul>");
			listType = "";
		};
		let flushCodeBlock = () => {
			if (!inCodeBlock) return;
			let classAttr = codeLanguage
				? ` class="language-${this.escapeHTML(codeLanguage)}"`
				: "";
			let codeHTML = this.escapeHTML(codeBlockLines.join("\n"));
			htmlParts.push(`<pre><code${classAttr}>${codeHTML}</code></pre>`);
			inCodeBlock = false;
			codeBlockLines = [];
			codeLanguage = "";
		};

		for (let i = 0; i < lines.length; i++) {
			let rawLine = lines[i];
			let line = rawLine || "";
			let trimmed = line.trim();
			let fenceMatch = trimmed.match(/^```([\w-]+)?\s*$/);
			if (fenceMatch) {
				flushParagraph();
				closeList();
				if (inCodeBlock) {
					flushCodeBlock();
				}
				else {
					inCodeBlock = true;
					codeLanguage = fenceMatch[1] || "";
				}
				continue;
			}
			if (inCodeBlock) {
				codeBlockLines.push(line);
				continue;
			}

			if (!trimmed) {
				flushParagraph();
				closeList();
				continue;
			}

			let displayMathResult = this.parseDisplayMathBlock(lines, i);
			if (displayMathResult) {
				flushParagraph();
				closeList();
				htmlParts.push(displayMathResult.html);
				i = displayMathResult.nextIndex;
				continue;
			}

			let htmlTableResult = this.parseHTMLTableBlock(lines, i);
			if (htmlTableResult) {
				flushParagraph();
				closeList();
				htmlParts.push(htmlTableResult.html);
				i = htmlTableResult.nextIndex;
				continue;
			}

			let tableResult = this.parseMarkdownTableBlock(lines, i);
			if (tableResult) {
				flushParagraph();
				closeList();
				htmlParts.push(tableResult.html);
				i = tableResult.nextIndex;
				continue;
			}

			let headingMatch = line.match(/^\s*(#{1,6})\s+(.+)$/);
			if (headingMatch) {
				flushParagraph();
				closeList();
				let level = headingMatch[1].length;
				let titleText = this.renderInlineMarkdown(headingMatch[2].trim());
				htmlParts.push(`<h${level}>${titleText}</h${level}>`);
				continue;
			}

			if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
				flushParagraph();
				closeList();
				htmlParts.push("<hr/>");
				continue;
			}

			let orderedMatch = line.match(/^\s*(\d+)\.\s+(.+)$/);
			if (orderedMatch) {
				flushParagraph();
				if (listType && listType !== "ol") {
					closeList();
				}
				if (!listType) {
					htmlParts.push("<ol>");
					listType = "ol";
				}
				htmlParts.push(`<li>${this.renderInlineMarkdown(orderedMatch[2])}</li>`);
				continue;
			}

			let unorderedMatch = line.match(/^\s*[-*+]\s+(.+)$/);
			if (unorderedMatch) {
				flushParagraph();
				if (listType && listType !== "ul") {
					closeList();
				}
				if (!listType) {
					htmlParts.push("<ul>");
					listType = "ul";
				}
				htmlParts.push(`<li>${this.renderInlineMarkdown(unorderedMatch[1])}</li>`);
				continue;
			}

			let blockquoteMatch = line.match(/^\s*>\s?(.*)$/);
			if (blockquoteMatch) {
				flushParagraph();
				closeList();
				let blockquoteHTML = this.renderInlineMarkdown(blockquoteMatch[1] || "");
				htmlParts.push(`<blockquote><p>${blockquoteHTML}</p></blockquote>`);
				continue;
			}

			paragraph.push(line);
		}

		flushCodeBlock();
		flushParagraph();
		closeList();
		return htmlParts.join("");
	},

	parseDisplayMathBlock(lines, startIndex) {
		let startLine = String(lines[startIndex] || "");
		let trimmed = startLine.trim();
		if (!trimmed.startsWith("$$")) return null;
		let normalized = trimmed.replace(/\s+/g, " ");

		if (/^\$\$\s*$/.test(normalized)) {
			let mathLines = [];
			for (let i = startIndex + 1; i < lines.length; i++) {
				let current = String(lines[i] || "");
				if (/^\s*\$\$\s*$/.test(current.trim())) {
					return {
						html: this.renderDisplayMathHTML(mathLines.join("\n")),
						nextIndex: i
					};
				}
				mathLines.push(current);
			}
			return null;
		}

		let singleLine = startLine.match(/^\s*\$\$(.*?)\$\$\s*$/);
		if (singleLine) {
			return {
				html: this.renderDisplayMathHTML(singleLine[1] || ""),
				nextIndex: startIndex
			};
		}

		let firstLine = startLine.replace(/^\s*\$\$\s?/, "");
		let mathLines = [firstLine];
		for (let i = startIndex + 1; i < lines.length; i++) {
			let current = String(lines[i] || "");
			let closeMatch = current.match(/^(.*)\$\$\s*$/);
			if (closeMatch) {
				mathLines.push(closeMatch[1] || "");
				return {
					html: this.renderDisplayMathHTML(mathLines.join("\n")),
					nextIndex: i
				};
			}
			mathLines.push(current);
		}
		return null;
	},

	renderDisplayMathHTML(tex) {
		let normalized = String(tex || "").replace(/^\n+|\n+$/g, "");
		return `<pre class="math">$$${this.escapeHTML(normalized)}$$</pre>`;
	},

	parseHTMLTableBlock(lines, startIndex) {
		let firstLine = String(lines[startIndex] || "");
		let trimmed = firstLine.trim();
		if (!/^<table\b/i.test(trimmed)) return null;

		let endIndex = startIndex;
		let foundClose = /<\/table>\s*$/i.test(trimmed);
		while (!foundClose && endIndex + 1 < lines.length) {
			endIndex++;
			let current = String(lines[endIndex] || "").trim();
			if (/<\/table>/i.test(current)) {
				foundClose = true;
				break;
			}
		}
		if (!foundClose) return null;

		let rawTableHTML = lines.slice(startIndex, endIndex + 1).join("\n");
		return {
			html: this.normalizeHTMLTableForNote(rawTableHTML),
			nextIndex: endIndex
		};
	},

	normalizeHTMLTableForNote(rawTableHTML) {
		let raw = String(rawTableHTML || "").trim();
		if (!raw) return "";
		try {
			if (typeof DOMParser !== "function") {
				return raw;
			}
			let doc = new DOMParser().parseFromString(`<body>${raw}</body>`, "text/html");
			let table = doc.querySelector("table");
			if (!table) {
				return raw;
			}
			table.querySelectorAll("script, style").forEach((node) => node.remove());
			this.convertMathMarkersInsideTable(table, doc);
			return table.outerHTML || raw;
		}
		catch (e) {
			this.log(`Normalize HTML table failed: ${e}`);
			return raw;
		}
	},

	convertMathMarkersInsideTable(tableElement, doc) {
		if (!tableElement || !doc) return;
		let skipTags = new Set(["CODE", "PRE", "SCRIPT", "STYLE", "MATH"]);
		let walk = (node) => {
			if (!node) return;
			if (node.nodeType === 1) {
				let tagName = String(node.tagName || "").toUpperCase();
				if (skipTags.has(tagName)) return;
				let className = String(node.getAttribute?.("class") || "");
				if (/\bmath\b/.test(className)) return;
				let children = Array.from(node.childNodes || []);
				for (let child of children) {
					walk(child);
				}
				return;
			}
			if (node.nodeType !== 3) return;
			let text = String(node.nodeValue || "");
			if (!text.includes("$")) return;
			let segments = this.splitMathTextSegments(text);
			if (!segments || !segments.some((x) => x.type !== "text")) return;
			let fragment = doc.createDocumentFragment();
			for (let segment of segments) {
				if (segment.type === "text") {
					fragment.appendChild(doc.createTextNode(segment.value));
					continue;
				}
				if (segment.type === "inline") {
					let span = doc.createElement("span");
					span.setAttribute("class", "math");
					span.textContent = `$${segment.value}$`;
					fragment.appendChild(span);
					continue;
				}
				if (segment.type === "display") {
					let pre = doc.createElement("pre");
					pre.setAttribute("class", "math");
					pre.textContent = `$$${segment.value}$$`;
					fragment.appendChild(pre);
					continue;
				}
			}
			node.parentNode?.replaceChild(fragment, node);
		};

		let cells = tableElement.querySelectorAll("td, th");
		for (let cell of cells) {
			walk(cell);
		}
	},

	splitMathTextSegments(text) {
		let value = String(text || "");
		let segments = [];
		let buffer = "";
		let i = 0;
		let flushBuffer = () => {
			if (!buffer) return;
			segments.push({
				type: "text",
				value: buffer
			});
			buffer = "";
		};

		while (i < value.length) {
			let ch = value[i];
			if (ch === "\\") {
				buffer += value.slice(i, Math.min(i + 2, value.length));
				i += 2;
				continue;
			}
			if (ch !== "$") {
				buffer += ch;
				i++;
				continue;
			}

			let isDisplay = value[i + 1] === "$";
			if (isDisplay) {
				let end = i + 2;
				let found = false;
				while (end < value.length - 1) {
					if (value[end] === "\\") {
						end += 2;
						continue;
					}
					if (value[end] === "$" && value[end + 1] === "$") {
						found = true;
						break;
					}
					end++;
				}
				if (!found) {
					buffer += "$$";
					i += 2;
					continue;
				}
				let tex = value.slice(i + 2, end);
				if (!tex.trim()) {
					buffer += "$$";
					i += 2;
					continue;
				}
				flushBuffer();
				segments.push({
					type: "display",
					value: tex
				});
				i = end + 2;
				continue;
			}

			let end = i + 1;
			let found = false;
			while (end < value.length) {
				if (value[end] === "\\") {
					end += 2;
					continue;
				}
				if (value[end] === "\n") break;
				if (value[end] === "$") {
					if (value[end + 1] === "$") {
						end += 2;
						continue;
					}
					found = true;
					break;
				}
				end++;
			}
			if (!found) {
				buffer += "$";
				i++;
				continue;
			}
			let tex = value.slice(i + 1, end);
			if (!tex.trim()) {
				buffer += "$$";
				i = end + 1;
				continue;
			}
			flushBuffer();
			segments.push({
				type: "inline",
				value: tex
			});
			i = end + 1;
		}

		flushBuffer();
		return segments;
	},

	parseMarkdownTableBlock(lines, startIndex) {
		let headerLine = String(lines[startIndex] || "");
		let delimiterLine = String(lines[startIndex + 1] || "");
		if (!this.isMarkdownTableHeaderLine(headerLine)) return null;
		if (!this.isMarkdownTableDelimiterLine(delimiterLine)) return null;

		let headerCells = this.splitMarkdownTableRow(headerLine);
		if (!headerCells.length) return null;

		let delimiterCells = this.splitMarkdownTableRow(delimiterLine);
		let columnCount = Math.max(headerCells.length, delimiterCells.length);
		if (!columnCount) return null;

		let alignments = this.buildMarkdownTableAlignments(delimiterCells, columnCount);
		let bodyRows = [];
		let endIndex = startIndex + 1;

		for (let i = startIndex + 2; i < lines.length; i++) {
			let row = String(lines[i] || "");
			let trimmed = row.trim();
			if (!trimmed) break;
			if (!row.includes("|")) break;
			if (/^\s*```/.test(row)) break;
			if (/^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/.test(row)) break;
			let cells = this.splitMarkdownTableRow(row);
			if (!cells.length) break;
			bodyRows.push(cells);
			endIndex = i;
		}

		return {
			html: this.renderMarkdownTableHTML({
				headerCells,
				alignments,
				bodyRows,
				columnCount
			}),
			nextIndex: endIndex
		};
	},

	isMarkdownTableHeaderLine(line) {
		let row = String(line || "");
		if (!row.includes("|")) return false;
		let cells = this.splitMarkdownTableRow(row);
		return cells.length >= 2;
	},

	isMarkdownTableDelimiterLine(line) {
		let row = String(line || "");
		let cells = this.splitMarkdownTableRow(row);
		if (!cells.length) return false;
		return cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
	},

	splitMarkdownTableRow(row) {
		let value = String(row || "").trim();
		if (!value.includes("|")) return [];
		if (value.startsWith("|")) value = value.slice(1);
		if (value.endsWith("|")) value = value.slice(0, -1);
		return value.split("|").map((cell) => cell.trim());
	},

	buildMarkdownTableAlignments(delimiterCells, columnCount) {
		let alignments = [];
		for (let i = 0; i < columnCount; i++) {
			let raw = String(delimiterCells[i] || "").replace(/\s+/g, "");
			if (/^:-+:$/.test(raw)) {
				alignments.push("center");
			}
			else if (/^-+:$/.test(raw)) {
				alignments.push("right");
			}
			else if (/^:-+$/.test(raw)) {
				alignments.push("left");
			}
			else {
				alignments.push("");
			}
		}
		return alignments;
	},

	renderMarkdownTableHTML({ headerCells, alignments, bodyRows, columnCount }) {
		let normalizedHeader = [];
		for (let i = 0; i < columnCount; i++) {
			normalizedHeader.push(headerCells[i] || "");
		}

		let thead = "<thead><tr>" + normalizedHeader.map((cell, idx) => {
			let align = alignments[idx] ? ` style="text-align: ${alignments[idx]};"` : "";
			return `<th${align}>${this.renderInlineMarkdown(cell)}</th>`;
		}).join("") + "</tr></thead>";

		let tbody = "";
		if (bodyRows.length) {
			let bodyHTML = bodyRows.map((row) => {
				let normalizedRow = [];
				for (let i = 0; i < columnCount; i++) {
					normalizedRow.push(row[i] || "");
				}
				return "<tr>" + normalizedRow.map((cell, idx) => {
					let align = alignments[idx] ? ` style="text-align: ${alignments[idx]};"` : "";
					return `<td${align}>${this.renderInlineMarkdown(cell)}</td>`;
				}).join("") + "</tr>";
			}).join("");
			tbody = `<tbody>${bodyHTML}</tbody>`;
		}
		return `<table>${thead}${tbody}</table>`;
	},

	renderInlineMarkdown(text) {
		let value = String(text || "");
		let codeTokens = [];
		value = value.replace(/`([^`]+)`/g, (_m, codeText) => {
			let token = `@@C${codeTokens.length}@@`;
			codeTokens.push(`<code>${this.escapeHTML(codeText)}</code>`);
			return token;
		});
		let mathTokens = [];
		value = this.replaceInlineMathWithTokens(value, mathTokens);

		let escaped = this.escapeHTML(value);
		let imageTokens = [];
		escaped = escaped.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, target) => {
			let token = `@@I${imageTokens.length}@@`;
			let targetInfo = this.parseMarkdownImageTarget(target);
			let src = this.escapeHTML(targetInfo.url || "");
			let altText = this.escapeHTML(alt || "");
			let titleAttr = targetInfo.title
				? ` title="${this.escapeHTML(targetInfo.title)}"`
				: "";
			imageTokens.push(`<img src="${src}" alt="${altText}"${titleAttr} />`);
			return token;
		});

		escaped = escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, target) => {
			let info = this.parseMarkdownImageTarget(target);
			let href = this.escapeHTML(info.url || "");
			let titleAttr = info.title
				? ` title="${this.escapeHTML(info.title)}"`
				: "";
			return `<a href="${href}"${titleAttr}>${label}</a>`;
		});
		escaped = escaped
			.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
			.replace(/__([^_]+)__/g, "<strong>$1</strong>");

		escaped = escaped.replace(/@@I(\d+)@@/g, (_m, idx) => imageTokens[Number(idx)] || "");
		escaped = escaped.replace(/@@M(\d+)@@/g, (_m, idx) => mathTokens[Number(idx)] || "");
		escaped = escaped.replace(/@@C(\d+)@@/g, (_m, idx) => codeTokens[Number(idx)] || "");
		return escaped;
	},

	replaceInlineMathWithTokens(text, mathTokens) {
		let value = String(text || "");
		let output = "";
		let i = 0;
		while (i < value.length) {
			let ch = value[i];
			if (ch === "\\") {
				output += value.slice(i, Math.min(i + 2, value.length));
				i += 2;
				continue;
			}
			if (ch !== "$" || value[i + 1] === "$") {
				output += ch;
				i++;
				continue;
			}
			let end = i + 1;
			let found = false;
			while (end < value.length) {
				let current = value[end];
				if (current === "\\") {
					end += 2;
					continue;
				}
				if (current === "\n") {
					break;
				}
				if (current === "$") {
					if (value[end + 1] === "$") {
						end += 2;
						continue;
					}
					found = true;
					break;
				}
				end++;
			}
			if (!found) {
				output += ch;
				i++;
				continue;
			}
			let tex = value.slice(i + 1, end);
			if (!tex.trim()) {
				output += "$$";
				i = end + 1;
				continue;
			}
			let token = `@@M${mathTokens.length}@@`;
			mathTokens.push(`<span class="math">$${this.escapeHTML(tex)}$</span>`);
			output += token;
			i = end + 1;
		}
		return output;
	},
	
	pathToNSIFile(path, createIfMissing = false) {
		let file = Components.classes["@mozilla.org/file/local;1"]
			.createInstance(Components.interfaces.nsIFile);
		file.initWithPath(path);
		if (createIfMissing && !file.exists()) {
			file.create(Components.interfaces.nsIFile.NORMAL_FILE_TYPE, 0o600);
		}
		return file;
	},
	
	pickMarkdownEntry(zipReader, originalFileName) {
		let entries = [];
		let enumerator = zipReader.findEntries(null);
		while (enumerator.hasMore()) {
			let name = enumerator.getNext();
			if (name.toLowerCase().endsWith(".md")) {
				entries.push(name);
			}
		}
		if (!entries.length) return null;
		
		let baseName = originalFileName.replace(/\.[^.]+$/, "");
		let exact = entries.find((name) => name === `${baseName}.md` || name.endsWith(`/${baseName}.md`));
		if (exact) return exact;
		
		let nonLayout = entries.find((name) => !name.endsWith("_layout.md"));
		if (nonLayout) return nonLayout;
		
		return entries[0];
	},

	buildPrefixedNoteTitle(prefix, attachmentTitle) {
		let baseTitle = String(attachmentTitle || "").trim() || "PDF";
		let cleanPrefix = String(prefix || "").trim();
		if (!cleanPrefix) return baseTitle;
		let normalizedBase = baseTitle.toLowerCase();
		let normalizedPrefix = cleanPrefix.toLowerCase();
		if (
			normalizedBase === normalizedPrefix
			|| normalizedBase.startsWith(normalizedPrefix + " ")
			|| normalizedBase.startsWith(normalizedPrefix + "-")
			|| normalizedBase.startsWith(normalizedPrefix + "_")
		) {
			return baseTitle;
		}
		return `${cleanPrefix} ${baseTitle}`;
	},

	stripHTMLToPlainText(html) {
		return String(html || "")
			.replace(/<script[\s\S]*?<\/script>/gi, " ")
			.replace(/<style[\s\S]*?<\/style>/gi, " ")
			.replace(/<[^>]+>/g, " ")
			.replace(/&nbsp;/gi, " ")
			.replace(/&amp;/gi, "&")
			.replace(/&lt;/gi, "<")
			.replace(/&gt;/gi, ">")
			.replace(/&quot;/gi, "\"")
			.replace(/&#39;/gi, "'")
			.replace(/\s+/g, " ")
			.trim();
	},

	ensureNoteTitleInHTML(contentHTML, noteTitle) {
		let title = String(noteTitle || "").trim();
		let html = String(contentHTML || "").trim();
		if (!title) {
			return html || "<p></p>";
		}
		let plain = this.stripHTMLToPlainText(html).toLowerCase();
		let normalizedTitle = title.toLowerCase();
		if (plain.startsWith(normalizedTitle)) {
			return html || "<p></p>";
		}
		let titleParagraph = `<p><strong>${this.escapeHTML(title)}</strong></p>`;
		if (!html) return titleParagraph;
		return `${titleParagraph}\n${html}`;
	},

	trySetNoteTitle(note, title) {
		let cleanTitle = String(title || "").trim();
		if (!note || !cleanTitle || typeof note.setField !== "function") return;
		try {
			note.setField("title", cleanTitle);
		}
		catch (e) {
			this.log(`设置笔记标题失败: ${e?.message || e}`);
		}
	},

	async saveResultAsNote({ attachment, parentItem, parsedResult, settings }) {
		let attachmentTitle = attachment.getField("title")
			|| this.fileNameFromPath(attachment.getFilePath() || "PDF");
		let noteTitle = this.buildPrefixedNoteTitle(
			settings?.noteTitlePrefix,
			attachmentTitle
		);
		let note = new Zotero.Item("note");
		note.libraryID = attachment.libraryID;
		if (parentItem) {
			note.parentID = parentItem.id;
		}
		
		let markdownText = parsedResult?.markdownText || "";
		let contentHTML = parsedResult?.contentHTML || this.convertMarkdownToBasicHTML(markdownText);
		let embeddedImages = Array.isArray(parsedResult?.embeddedImages)
			? parsedResult.embeddedImages
			: [];
		note.setNote("<p></p>");
		this.trySetNoteTitle(note, noteTitle);
		await note.saveTx();
			let embeddedResult = await this.materializeEmbeddedImagesForNote({
				note,
				contentHTML,
				embeddedImages
			});
			let noteHTML = this.ensureNoteTitleInHTML(
				embeddedResult.contentHTML || "<p></p>",
				noteTitle
			);
			note.setNote(noteHTML);
			this.trySetNoteTitle(note, noteTitle);
			note.addTag("#MinerU-Parse", 0);
			await note.saveTx();
			if (parentItem) {
				parentItem.addTag("#MinerU-Parsed", 0);
				await parentItem.saveTx();
			}
	},

	rewriteImagePathsForStorage(rawMarkdownText, embeddedImages) {
		if (!Array.isArray(embeddedImages) || !embeddedImages.length) {
			return { markdownText: rawMarkdownText, imageFileMap: new Map() }
		}

		// Build mapping: normalized original path → unique filename for images/ dir
		let usedNames = new Map()
		let pathToStorageName = new Map()
		let imageFileMap = new Map() // storageName → image object

		for (let image of embeddedImages) {
			let baseName = image.fileName || this.fileNameFromPath(image.entryName) || `image-${image.id}.png`
			let nameKey = baseName.toLowerCase()
			if (usedNames.has(nameKey)) {
				let count = usedNames.get(nameKey) + 1
				usedNames.set(nameKey, count)
				let dotIdx = baseName.lastIndexOf(".")
				if (dotIdx > 0) {
					baseName = baseName.slice(0, dotIdx) + `_${count}` + baseName.slice(dotIdx)
				} else {
					baseName = baseName + `_${count}`
				}
			} else {
				usedNames.set(nameKey, 1)
			}
			let storageName = `images/${baseName}`

			// Map all possible path references to this image
			let entryName = image.entryName || ""
			let normalized = this.normalizeArchivePath(entryName)
			if (normalized) pathToStorageName.set(normalized.toLowerCase(), storageName)
			pathToStorageName.set(entryName.toLowerCase(), storageName)
			let justFile = this.fileNameFromPath(entryName)
			if (justFile && !pathToStorageName.has(justFile.toLowerCase())) {
				pathToStorageName.set(justFile.toLowerCase(), storageName)
			}
			imageFileMap.set(baseName, image)
		}

		// Replace markdown image references: ![alt](path)
		let result = rawMarkdownText.replace(
			/!\[([^\]]*)\]\(([^)]+)\)/g,
			(match, alt, rawTarget) => {
				let targetInfo = this.parseMarkdownImageTarget(rawTarget)
				let url = (targetInfo?.url || rawTarget || "").trim()
				if (/^(https?:|\/\/|#|data:)/i.test(url)) return match
				let normalized = this.normalizeArchivePath(url)
				let lookup = (normalized || url).toLowerCase()
				let storageName = pathToStorageName.get(lookup)
				if (!storageName) {
					let justFile = this.fileNameFromPath(url)
					storageName = pathToStorageName.get((justFile || "").toLowerCase())
				}
				if (!storageName) return match
				let titlePart = targetInfo?.title ? ` "${targetInfo.title}"` : ""
				return `![${alt}](${storageName}${titlePart})`
			}
		)

		// Replace HTML image references: <img src="path">
		result = result.replace(
			/<img\b([^>]*?)\bsrc=(["'])([^"']+)\2([^>]*)>/gi,
			(match, before, quote, src, after) => {
				if (/^(https?:|\/\/|#|data:)/i.test(src)) return match
				let normalized = this.normalizeArchivePath(src)
				let lookup = (normalized || src).toLowerCase()
				let storageName = pathToStorageName.get(lookup)
				if (!storageName) {
					let justFile = this.fileNameFromPath(src)
					storageName = pathToStorageName.get((justFile || "").toLowerCase())
				}
				if (!storageName) return match
				return `<img${before}src=${quote}${storageName}${quote}${after}>`
			}
		)

		return { markdownText: result, imageFileMap }
	},

	sanitizeFileName(name) {
		return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, " ").trim()
	},

	rewriteTranslationImageLinksToSourceStorage(markdownText, sourceAttachment) {
		let sourceKey = sourceAttachment?.key
		if (!sourceKey) return markdownText

		let rewriteURL = (url) => {
			let cleanURL = String(url || "").trim()
			if (!cleanURL) return cleanURL
			if (/^(https?:|\/\/|#|data:|attachments:)/i.test(cleanURL)) return cleanURL
			if (cleanURL.startsWith(`../${sourceKey}/`)) return cleanURL

			let normalized = cleanURL
				.replace(/\\/g, "/")
				.replace(/^\.\/+/, "")
				.replace(/^\/+/, "")
			if (!normalized || normalized.startsWith("../")) return cleanURL

			return `../${sourceKey}/${normalized}`
		}

		let result = String(markdownText || "").replace(
			/!\[([^\]]*)\]\(([^)]+)\)/g,
			(match, alt, rawTarget) => {
				let targetInfo = this.parseMarkdownImageTarget(rawTarget)
				let url = rewriteURL(targetInfo?.url || rawTarget)
				if (url === (targetInfo?.url || rawTarget)) return match
				let titlePart = targetInfo?.title ? ` "${targetInfo.title}"` : ""
				return `![${alt}](${url}${titlePart})`
			}
		)

		result = result.replace(
			/<img\b([^>]*?)\bsrc=(["'])([^"']+)\2([^>]*)>/gi,
			(match, before, quote, src, after) => {
				let rewritten = rewriteURL(src)
				if (rewritten === src) return match
				return `<img${before}src=${quote}${rewritten}${quote}${after}>`
			}
		)

		return result
	},

	async saveResultAsMarkdownAttachment({ attachment, parentItem, parsedResult, settings }) {
		let attachmentTitle = attachment.getField("title")
			|| this.fileNameFromPath(attachment.getFilePath() || "PDF")
		let prefix = settings?.noteTitlePrefix || "MinerU Parse"
		let mdFileName = this.sanitizeFileName(`${prefix} - ${attachmentTitle}`) + ".md"

		let rawMarkdownText = parsedResult?.rawMarkdownText || ""
		let embeddedImages = Array.isArray(parsedResult?.embeddedImages)
			? parsedResult.embeddedImages
			: []

		// Rewrite image paths to images/<filename>
		let rewritten = this.rewriteImagePathsForStorage(rawMarkdownText, embeddedImages)
		let mdContent = rewritten.markdownText

		// Write .md to temp dir
		let tempDir = PathUtils.join(
			PathUtils.tempDir,
			`zotero-mineru-md-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
		)
		await IOUtils.makeDirectory(tempDir, { createAncestors: true })
		let mdTempPath = PathUtils.join(tempDir, mdFileName)
		await IOUtils.writeUTF8(mdTempPath, mdContent)

		try {
			// Create stored file attachment
			let mdAttachment = await Zotero.Attachments.importFromFile({
				file: mdTempPath,
				libraryID: attachment.libraryID,
				parentItemID: parentItem ? parentItem.id : undefined,
				contentType: "text/markdown",
				charset: "utf-8"
			})

			// Get storage directory and write images
			let storagePath = PathUtils.parent(await mdAttachment.getFilePath())
			if (embeddedImages.length) {
				let imagesDir = PathUtils.join(storagePath, "images")
				await IOUtils.makeDirectory(imagesDir, { createAncestors: true })
				for (let [baseName, image] of rewritten.imageFileMap) {
					if (!image.bytes) continue
					let imagePath = PathUtils.join(imagesDir, baseName)
					await IOUtils.write(imagePath, image.bytes)
				}
			}

			// Tag the attachment and parent
			mdAttachment.addTag("#MinerU-Parse", 0)
			await mdAttachment.saveTx()
			if (parentItem) {
				parentItem.addTag("#MinerU-Parsed", 0)
				await parentItem.saveTx()
			}

			this.log(`Markdown 附件已保存: ${mdFileName} (${embeddedImages.length} 张图片)`)
		}
		finally {
			// Clean up temp files
			await IOUtils.remove(mdTempPath).catch(() => {})
			await IOUtils.remove(tempDir, { recursive: true }).catch(() => {})
		}
	},

	async materializeEmbeddedImagesForNote({ note, contentHTML, embeddedImages }) {
		let html = String(contentHTML || "");
		if (!note?.id || !Array.isArray(embeddedImages) || !embeddedImages.length) {
			return {
				contentHTML: html,
				importedCount: 0,
				fallbackCount: 0
			};
		}
		let importedCount = 0;
		let fallbackCount = 0;
		for (let image of embeddedImages) {
			let attachmentKey = await this.importEmbeddedImageForNote({
				noteID: note.id,
				image
			});
			if (!attachmentKey) {
				html = this.replaceImageMarkerWithDataURI(html, image.marker, image.dataURI);
				fallbackCount++;
				continue;
			}
			importedCount++;
			html = this.replaceImageMarkerWithAttachment(
				html,
				image.marker,
				attachmentKey,
				image.mimeType,
				image.fileName
			);
		}
		for (let image of embeddedImages) {
			if (html.includes(image.marker)) {
				html = this.replaceImageMarkerWithDataURI(html, image.marker, image.dataURI);
				fallbackCount++;
			}
		}
		return {
			contentHTML: html,
			importedCount,
			fallbackCount
		};
	},

	async importEmbeddedImageForNote({ noteID, image }) {
		if (!noteID || !image?.bytes || !Zotero?.Attachments) return null;
		if (typeof Blob !== "function") {
			this.log("Blob is unavailable; cannot import embedded images");
			return null;
		}
		let blob = new Blob([image.bytes], {
			type: image.mimeType || "application/octet-stream"
		});
		try {
			if (typeof Zotero.Attachments.importEmbeddedImage === "function") {
				let attachmentItem = await this.withTimeout(
					() => Zotero.Attachments.importEmbeddedImage({
						blob,
						parentItemID: noteID
					}),
					15000,
					"导入内嵌图片"
				);
				return attachmentItem?.key || null;
			}
		}
		catch (e) {
			this.log(`importEmbeddedImage failed: ${e}`);
			Zotero.logError(e);
		}
		return null;
	},

	async withTimeout(taskFactory, timeoutMS, label = "任务") {
		let timeoutID = null;
		let timeoutPromise = new Promise((_, reject) => {
			timeoutID = setTimeout(() => {
				let error = new Error(`${label}超时（${Math.ceil(timeoutMS / 1000)}秒）`);
				error.name = "TimeoutError";
				error.code = "ETIMEDOUT";
				error.timeoutMS = timeoutMS;
				reject(error);
			}, timeoutMS);
		});
		try {
			return await Promise.race([
				Promise.resolve().then(taskFactory),
				timeoutPromise
			]);
		}
		finally {
			if (timeoutID !== null) {
				clearTimeout(timeoutID);
			}
		}
	},

	isTimeoutError(error) {
		return !!(error && (error.name === "TimeoutError" || error.code === "ETIMEDOUT"));
	},

	formatUserFacingError(error, fallbackMessage = "执行失败") {
		let message = error?.message || String(error || fallbackMessage)
		if (!message) return fallbackMessage
		if (this.isTimeoutError(error)) {
			return `${message}。可尝试减小“翻译并发请求数”或“翻译分段字符数”后重试。`
		}
		return message
	},

	buildChunkFailureMessage(failure) {
		let chunkLabel = `第 ${failure.chunkIndex + 1}/${failure.totalChunks} 段`
		let attemptsLabel = failure.attempts > 1 ? `（已尝试 ${failure.attempts} 次）` : ""
		return `${chunkLabel}${attemptsLabel}: ${this.formatUserFacingError(failure.error, "翻译失败")}`
	},

	buildFailedChunkSummary(failures, limit = 10) {
		return failures
			.slice(0, limit)
			.map((failure) => this.buildChunkFailureMessage(failure))
			.join("\n")
	},

	confirmRetryFailedChunks(window, { title, failures, retryRound, autoRetryCount }) {
		if (!failures.length) return false
		let summary = this.buildFailedChunkSummary(failures, 8)
		let hiddenCount = Math.max(failures.length - 8, 0)
		let message =
			`${title}\n\n` +
			`以下段落在自动重试 ${autoRetryCount} 次后仍然失败：\n` +
			`${summary}`
		if (hiddenCount) {
			message += `\n… 另有 ${hiddenCount} 段失败`
		}
		message += `\n\n是否现在只重试这些失败段落？`
		if (retryRound > 1) {
			message += `\n这是第 ${retryRound} 轮人工确认重试。`
		}
		return this.showConfirm(window, "AI 翻译失败段重试", message)
	},

	replaceImageMarkerWithAttachment(html, marker, attachmentKey, mimeType, fileName) {
		if (!html || !marker || !attachmentKey) return html;
		let escapedMarker = this.escapeRegExp(marker);
		let ext = this.guessImageExtension(mimeType, fileName);
		let src = `attachments/${attachmentKey}.${ext}`;
		let imgTagRegex = new RegExp(`<img([^>]*?)\\bsrc=(["'])${escapedMarker}\\2([^>]*)>`, "gi");
		return html.replace(imgTagRegex, (_m, before, _quote, after) => {
			let tagBody = `${before || ""} ${after || ""}`;
			let cleaned = tagBody
				.replace(/\sdata-attachment-key=(["']).*?\1/gi, "")
				.replace(/\ssrc=(["']).*?\1/gi, "")
				.replace(/\sztype=(["']).*?\1/gi, "")
				.replace(/\s+/g, " ")
				.trim();
			let attrs = cleaned ? ` ${cleaned}` : "";
			return `<img data-attachment-key="${attachmentKey}" src="${src}" ztype="zimage"${attrs}>`;
		});
	},

	replaceImageMarkerWithDataURI(html, marker, dataURI) {
		if (!html || !marker || !dataURI) return html;
		let escapedMarker = this.escapeRegExp(marker);
		let imgTagRegex = new RegExp(`<img([^>]*?)\\bsrc=(["'])${escapedMarker}\\2([^>]*)>`, "gi");
		return html.replace(imgTagRegex, (_m, before, _quote, after) => {
			return `<img${before || ""} src="${dataURI}"${after || ""}>`;
		});
	},

	guessImageExtension(mimeType, fileName = "") {
		let mime = String(mimeType || "").toLowerCase();
		if (mime === "image/png") return "png";
		if (mime === "image/jpeg") return "jpg";
		if (mime === "image/gif") return "gif";
		if (mime === "image/webp") return "webp";
		if (mime === "image/bmp") return "bmp";
		if (mime === "image/svg+xml") return "svg";
		if (mime === "image/tiff") return "tif";
		let name = this.fileNameFromPath(fileName);
		let dotIndex = name.lastIndexOf(".");
		if (dotIndex > 0 && dotIndex < name.length - 1) {
			return name.slice(dotIndex + 1).toLowerCase();
		}
		return "png";
	},

	escapeRegExp(value) {
		return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	},
		
	fileNameFromPath(path) {
		if (!path) return "file.pdf";
		let normalized = path.replace(/\\/g, "/");
		let index = normalized.lastIndexOf("/");
		return index >= 0 ? normalized.slice(index + 1) : normalized;
	},
	
	escapeHTML(input) {
		return String(input || "")
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")
			.replaceAll('"', "&quot;")
			.replaceAll("'", "&#39;");
	},
	
	async main() {
		this.log(`Loaded v${this.version}`);
	},

	getLLMSettings() {
		let apiBaseURL = (Zotero.Prefs.get(this.PREF_BRANCH + "llmApiBaseURL", true) || "").trim();
		apiBaseURL = apiBaseURL.replace(/\/+$/, "");
		let apiKey = (Zotero.Prefs.get(this.PREF_BRANCH + "llmApiKey", true) || "").trim();
		apiKey = apiKey.replace(/^Bearer\s+/i, "");
		let model = (Zotero.Prefs.get(this.PREF_BRANCH + "llmModel", true) || "").trim();
		let summaryLanguage = (Zotero.Prefs.get(this.PREF_BRANCH + "summaryLanguage", true) || "中文").trim();
		let translateLanguage = (Zotero.Prefs.get(this.PREF_BRANCH + "translateLanguage", true) || "中文").trim();
		let translateChunkSize = Zotero.Prefs.get(this.PREF_BRANCH + "translateChunkSize", true);
		if (!Number.isFinite(translateChunkSize) || translateChunkSize < 5000) translateChunkSize = 20000;
		let translateConcurrency = parseInt(Zotero.Prefs.get(this.PREF_BRANCH + "translateConcurrency", true), 10);
		if (!Number.isFinite(translateConcurrency) || translateConcurrency < 1) translateConcurrency = 3;
		if (translateConcurrency > 8) translateConcurrency = 8;
		let translateRetryCount = parseInt(Zotero.Prefs.get(this.PREF_BRANCH + "translateRetryCount", true), 10);
		if (!Number.isFinite(translateRetryCount) || translateRetryCount < 1) translateRetryCount = 2;
		if (translateRetryCount > 5) translateRetryCount = 5;
		return {
			apiBaseURL,
			apiKey,
			model,
			summaryLanguage,
			translateLanguage,
			translateChunkSize,
			translateConcurrency,
			translateRetryCount
		};
	},

	collectSummaryTasks(selectedItems) {
		let tasks = [];
		let seenParentIDs = new Set();
		for (let item of selectedItems) {
			let parentItem = null;
			if (item.isNote()) {
				let pid = item.parentItemID;
				parentItem = pid ? Zotero.Items.get(pid) : null;
			} else if (item.isRegularItem()) {
				parentItem = item;
			} else if (item.isAttachment()) {
				let pid = item.parentItemID;
				parentItem = pid ? Zotero.Items.get(pid) : null;
			}
			if (!parentItem || !parentItem.isRegularItem()) continue;
			if (seenParentIDs.has(parentItem.id)) continue;
			seenParentIDs.add(parentItem.id);

			let mineruSource = null
			let mineruSourceType = null

			// Check attachments first (new format: .md file)
			let attachmentIDs = parentItem.getAttachments()
			for (let attachmentID of attachmentIDs) {
				let attachmentItem = Zotero.Items.get(attachmentID)
				if (!attachmentItem) continue
				let tags = attachmentItem.getTags()
				if (tags.some((t) => t.tag === "#MinerU-Parse")) {
					mineruSource = attachmentItem
					mineruSourceType = "attachment"
					break
				}
			}

			// Fallback to notes (legacy format)
			if (!mineruSource) {
				let noteIDs = parentItem.getNotes()
				for (let noteID of noteIDs) {
					let noteItem = Zotero.Items.get(noteID)
					if (!noteItem) continue
					let tags = noteItem.getTags()
					if (tags.some((t) => t.tag === "#MinerU-Parse")) {
						mineruSource = noteItem
						mineruSourceType = "note"
						break
					}
				}
			}

			if (mineruSource) {
				let hasSummary = this.parentHasNoteWithTag(parentItem, "#MinerU-Summary");
				if (!hasSummary) {
					tasks.push({ parentItem, mineruSource, mineruSourceType });
				}
			}
		}
		return tasks;
	},

	async handleSummaryCommand({ window = null, selectedItems = null } = {}) {
		let llmSettings = this.getLLMSettings();
		if (!llmSettings.apiBaseURL || !llmSettings.apiKey || !llmSettings.model) {
			this.showAlert(window, "MinerU", "请先在设置中填写完整的 LLM API 信息（Base URL、API Key、模型名称）。");
			return;
		}

		let items = selectedItems
			|| window?.ZoteroPane?.getSelectedItems?.()
			|| [];
		let tasks = this.collectSummaryTasks(items);
		if (!tasks.length) {
			this.showAlert(window, "MinerU", "当前选择的条目没有带 #MinerU-Parse 标签的解析结果，请先使用 MinerU 解析 PDF。");
			return;
		}

		let progress = new Zotero.ProgressWindow({ closeOnClick: true });
		progress.changeHeadline("AI 文献总结");
		progress.show();

		let successes = 0;
		let failures = [];

		for (let task of tasks) {
			let title = task.parentItem.getField("title") || "未知文献";
			let itemProgress = new progress.ItemProgress(
				"chrome://zotero/skin/treeitem-note.png",
				title
			);
			try {
				if (typeof itemProgress.setText === "function") {
					itemProgress.setText(`${title}（提取文本）`);
				}
				let plainText = ""
				if (task.mineruSourceType === "attachment") {
					let filePath = await task.mineruSource.getFilePath()
					if (!filePath) throw new Error("MinerU Markdown 附件文件不存在")
					let fileBytes = await IOUtils.read(filePath)
					plainText = new TextDecoder("utf-8").decode(fileBytes)
				} else {
					let noteHTML = task.mineruSource.getNote() || ""
					plainText = this.stripHTMLToPlainText(noteHTML)
				}
				if (plainText.length > 60000) {
					plainText = plainText.slice(0, 60000);
				}
				if (!plainText.trim()) {
					throw new Error("MinerU 解析内容为空");
				}

				if (typeof itemProgress.setText === "function") {
					itemProgress.setText(`${title}（调用 LLM）`);
				}
				let summary = await this.callLLMForSummary(plainText, llmSettings, llmSettings.summaryLanguage);

				if (typeof itemProgress.setText === "function") {
					itemProgress.setText(`${title}（保存笔记）`);
				}
				await this.saveSummaryAsNote({
					parentItem: task.parentItem,
					summaryText: summary
				});

				if (typeof itemProgress.setText === "function") {
					itemProgress.setText(`${title}（完成）`);
				}
				itemProgress.setProgress(100);
				successes++;
			} catch (e) {
				if (typeof itemProgress.setText === "function") {
					itemProgress.setText(`${title}（失败）`);
				}
				itemProgress.setError();
				failures.push(`${title}: ${e.message || e}`);
				Zotero.logError(e);
			}
		}

		progress.addDescription(`完成 ${successes}/${tasks.length}`);
		progress.startCloseTimer(5000);

		if (failures.length) {
			this.showAlert(window, "AI 总结部分失败", failures.slice(0, 10).join("\n"));
		}
	},

	async callLLMForSummary(plainText, llmSettings, language) {
		let url = `${llmSettings.apiBaseURL}/chat/completions`;
		language = language || "中文";
		let systemPrompt
		if (language === "中文") {
			systemPrompt = `你是一位学术研究助手。请根据用户提供的论文内容，用中文撰写一份结构化的学术总结。总结应包含以下几个部分：

## 研究背景
简要介绍研究领域和背景。

## 研究目的
明确说明本研究要解决的问题或目标。

## 研究方法
概述使用的主要方法和技术路线。

## 主要发现
列出关键的研究结果和发现。

## 结论与意义
总结研究的主要结论及其学术或实际意义。

请确保总结准确、简洁，忠实于原文内容，不要添加原文中没有的信息。`;
		} else {
			systemPrompt = `You are an academic research assistant. Based on the paper content provided by the user, write a structured academic summary in ${language}. The summary should include the following sections:

## Background
Briefly introduce the research field and background.

## Objectives
Clearly state the problem or goals of this research.

## Methods
Outline the main methods and technical approach.

## Key Findings
List the key research results and findings.

## Conclusions and Significance
Summarize the main conclusions and their academic or practical significance.

Ensure the summary is accurate, concise, and faithful to the original content. Do not add information not present in the original text. Write entirely in ${language}.`;
		}

		let userMessage = language === "中文"
			? `请总结以下论文内容：\n\n${plainText}`
			: `Please summarize the following paper:\n\n${plainText}`;

		let payload = {
			model: llmSettings.model,
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userMessage }
			],
			temperature: 0.3
		};

		let doFetch = async () => {
			let response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Authorization": `Bearer ${llmSettings.apiKey}`
				},
				body: JSON.stringify(payload)
			});

			if (!response.ok) {
				let errText = await response.text();
				throw new Error(`LLM API 请求失败 ${response.status}: ${errText.slice(0, 500)}`);
			}

			let result = await response.json();
			let content = result?.choices?.[0]?.message?.content;
			if (!content || !content.trim()) {
				throw new Error("LLM 返回内容为空");
			}
			return content.trim();
		};

		return await this.withTimeout(doFetch, 120000, "LLM API 请求");
	},

	async saveSummaryAsNote({ parentItem, summaryText }) {
		let parentTitle = parentItem.getField("title") || "未知文献";
		let noteTitle = `AI Summary ${parentTitle}`;
		let summaryHTML = this.convertMarkdownToBasicHTML(summaryText);
		let noteHTML = this.ensureNoteTitleInHTML(summaryHTML, noteTitle);

		let note = new Zotero.Item("note");
		note.libraryID = parentItem.libraryID;
		note.parentID = parentItem.id;
		note.setNote(noteHTML);
		this.trySetNoteTitle(note, noteTitle);
		note.addTag("#MinerU-Summary", 0);
		await note.saveTx();
	},

	// ==================== Translation Feature ====================

	collectTranslateTasks(selectedItems) {
		let tasks = []
		let seenParentIDs = new Set()
		for (let item of selectedItems) {
			let parentItem = null
			if (item.isNote()) {
				let pid = item.parentItemID
				parentItem = pid ? Zotero.Items.get(pid) : null
			} else if (item.isRegularItem()) {
				parentItem = item
			} else if (item.isAttachment()) {
				let pid = item.parentItemID
				parentItem = pid ? Zotero.Items.get(pid) : null
			}
			if (!parentItem || !parentItem.isRegularItem()) continue
			if (seenParentIDs.has(parentItem.id)) continue
			seenParentIDs.add(parentItem.id)

			let mineruSource = null

			// Find #MinerU-Parse attachment (Markdown file)
			let attachmentIDs = parentItem.getAttachments()
			for (let attachmentID of attachmentIDs) {
				let attachmentItem = Zotero.Items.get(attachmentID)
				if (!attachmentItem) continue
				let tags = attachmentItem.getTags()
				if (tags.some((t) => t.tag === "#MinerU-Parse")) {
					mineruSource = attachmentItem
					break
				}
			}

			if (mineruSource) {
				let hasTranslation = this.parentHasAttachmentWithTag(parentItem, "#MinerU-Translation")
				if (!hasTranslation) {
					tasks.push({ parentItem, mineruSource })
				}
			}
		}
		return tasks
	},

	async handleTranslateCommand({ window = null, selectedItems = null } = {}) {
		let llmSettings = this.getLLMSettings()
		if (!llmSettings.apiBaseURL || !llmSettings.apiKey || !llmSettings.model) {
			this.showAlert(window, "MinerU", "请先在设置中填写完整的 LLM API 信息（Base URL、API Key、模型名称）。")
			return
		}

		let items = selectedItems
			|| window?.ZoteroPane?.getSelectedItems?.()
			|| []
		let tasks = this.collectTranslateTasks(items)
		if (!tasks.length) {
			this.showAlert(window, "MinerU", "当前选择的条目没有可翻译的 MinerU 解析结果，请先使用 MinerU 解析 PDF。\n（已有翻译结果的条目会被跳过）")
			return
		}

		let language = llmSettings.translateLanguage || "中文"
		let chunkSize = llmSettings.translateChunkSize || 20000
		let translateConcurrency = llmSettings.translateConcurrency || 3
		let translateRetryCount = llmSettings.translateRetryCount || 2

		let progress = new Zotero.ProgressWindow({ closeOnClick: true })
		progress.changeHeadline(`AI 文献翻译 → ${language}`)
		progress.show()

		let successes = 0
		let failures = []

		for (let task of tasks) {
			let title = task.parentItem.getField("title") || "未知文献"
			let itemProgress = new progress.ItemProgress(
				"chrome://zotero/skin/treeitem-note.png",
				title
			)
			try {
				if (typeof itemProgress.setText === "function") {
					itemProgress.setText(`${title}（提取文本）`)
				}
				let filePath = await task.mineruSource.getFilePath()
				if (!filePath) throw new Error("MinerU Markdown 附件文件不存在")
				let fileBytes = await IOUtils.read(filePath)
				let fullText = new TextDecoder("utf-8").decode(fileBytes)
				if (!fullText.trim()) {
					throw new Error("MinerU 解析内容为空")
				}

				// Split into chunks for translation
				let chunks = this.splitMarkdownIntoChunks(fullText, chunkSize)
				let translatedParts = new Array(chunks.length)
				let activeConcurrency = Math.min(translateConcurrency, chunks.length)
				let pendingChunkIndexes = chunks.map((_chunk, index) => index)
				let retryRound = 0

				while (pendingChunkIndexes.length) {
					let batchLabel = retryRound ? `重试第 ${retryRound} 轮` : "翻译"
					if (typeof itemProgress.setText === "function") {
						itemProgress.setText(`${title}（${batchLabel} 0/${pendingChunkIndexes.length}，并发 ${activeConcurrency}）`)
					}
					let batchResult = await this.translateChunksWithConcurrency({
						chunks,
						chunkIndexes: pendingChunkIndexes,
						concurrency: activeConcurrency,
						autoRetryCount: translateRetryCount,
						translateChunk: (chunk, chunkIndex, totalChunks) => {
							return this.callLLMForTranslation(chunk, language, llmSettings, chunkIndex + 1, totalChunks)
						},
						onProgress: ({ completed, total }) => {
							let progressLabel = retryRound ? `重试第 ${retryRound} 轮` : "翻译"
							if (typeof itemProgress.setText === "function") {
								itemProgress.setText(`${title}（${progressLabel} ${completed}/${total}，并发 ${activeConcurrency}）`)
							}
						}
					})

					for (let [chunkIndex, translated] of batchResult.successes.entries()) {
						translatedParts[chunkIndex] = translated
					}

					if (!batchResult.failures.length) {
						break
					}

					if (typeof itemProgress.setText === "function") {
						itemProgress.setText(`${title}（等待确认重试失败段落）`)
					}
					retryRound++
					let shouldRetryFailures = this.confirmRetryFailedChunks(window, {
						title,
						failures: batchResult.failures,
						retryRound,
						autoRetryCount: translateRetryCount
					})
					if (!shouldRetryFailures) {
						throw new Error(this.buildFailedChunkSummary(batchResult.failures, 10) || "部分段落翻译失败")
					}
					pendingChunkIndexes = batchResult.failures.map((failure) => failure.chunkIndex)
					if (typeof itemProgress.setText === "function") {
						itemProgress.setText(`${title}（准备重试失败段落 ${pendingChunkIndexes.length} 段）`)
					}
				}

				if (translatedParts.some((part) => typeof part !== "string" || !part.trim())) {
					let missingChunks = translatedParts
						.map((part, index) => (typeof part === "string" && part.trim()) ? null : `第 ${index + 1}/${translatedParts.length} 段`)
						.filter(Boolean)
					throw new Error(`仍有未完成段落，无法合成结果：${missingChunks.slice(0, 10).join("，")}`)
				}

				if (typeof itemProgress.setText === "function") {
					itemProgress.setText(`${title}（合成翻译结果）`)
				}
				let translatedText = translatedParts.join("\n\n")

				if (typeof itemProgress.setText === "function") {
					itemProgress.setText(`${title}（保存附件）`)
				}
				await this.saveTranslationAsMarkdownAttachment({
					parentItem: task.parentItem,
					sourceAttachment: task.mineruSource,
					translatedText,
					language
				})

				if (typeof itemProgress.setText === "function") {
					itemProgress.setText(`${title}（完成）`)
				}
				itemProgress.setProgress(100)
				successes++
			} catch (e) {
				if (typeof itemProgress.setText === "function") {
					itemProgress.setText(`${title}（${this.isTimeoutError(e) ? "超时" : "失败"}）`)
				}
				itemProgress.setError()
				failures.push(`${title}: ${this.formatUserFacingError(e, "翻译失败")}`)
				Zotero.logError(e)
			}
		}

		progress.addDescription(`完成 ${successes}/${tasks.length}`)
		if (failures.length) {
			progress.addDescription(`失败 ${failures.length}/${tasks.length}`)
		}
		progress.startCloseTimer(5000)

		if (failures.length) {
			this.showAlert(window, "AI 翻译部分失败", failures.slice(0, 10).join("\n"))
		}
	},

	splitMarkdownIntoChunks(text, chunkSize) {
		if (text.length <= chunkSize) return [text]

		let chunks = []
		// Split by headings first (# or ##)
		let sections = text.split(/(?=^#{1,2}\s)/m)

		let currentChunk = ""
		for (let section of sections) {
			if (!section) continue
			if (currentChunk.length + section.length <= chunkSize) {
				currentChunk += section
			} else {
				if (currentChunk) chunks.push(currentChunk)
				// If a single section exceeds chunkSize, split by paragraphs
				if (section.length > chunkSize) {
					let paragraphs = section.split(/\n\n+/)
					currentChunk = ""
					for (let para of paragraphs) {
						if (currentChunk.length + para.length + 2 <= chunkSize) {
							currentChunk += (currentChunk ? "\n\n" : "") + para
						} else {
							if (currentChunk) chunks.push(currentChunk)
							// If a single paragraph still exceeds chunkSize, hard split by lines
							if (para.length > chunkSize) {
								let lines = para.split("\n")
								currentChunk = ""
								for (let line of lines) {
									if (currentChunk.length + line.length + 1 <= chunkSize) {
										currentChunk += (currentChunk ? "\n" : "") + line
									} else {
										if (currentChunk) chunks.push(currentChunk)
										currentChunk = line
									}
								}
							} else {
								currentChunk = para
							}
						}
					}
				} else {
					currentChunk = section
				}
			}
		}
		if (currentChunk) chunks.push(currentChunk)

		return chunks
	},

	async translateChunkWithRetry({ chunkText, chunkIndex, totalChunks, autoRetryCount, translateChunk }) {
		let maxAttempts = Math.max(autoRetryCount || 0, 0) + 1
		let lastError = null
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				let translated = await translateChunk(chunkText, chunkIndex, totalChunks)
				return {
					ok: true,
					chunkIndex,
					totalChunks,
					attempts: attempt,
					translated
				}
			} catch (e) {
				lastError = e
				Zotero.logError(e)
			}
		}
		return {
			ok: false,
			chunkIndex,
			totalChunks,
			attempts: maxAttempts,
			error: lastError || new Error("翻译失败")
		}
	},

	async translateChunksWithConcurrency({ chunks, chunkIndexes = null, concurrency, autoRetryCount, translateChunk, onProgress = null }) {
		if (!Array.isArray(chunks) || !chunks.length) {
			return { successes: new Map(), failures: [] }
		}

		let targets = Array.isArray(chunkIndexes) && chunkIndexes.length
			? [...chunkIndexes]
			: chunks.map((_chunk, index) => index)
		let successes = new Map()
		let failures = []
		let nextIndex = 0
		let completed = 0
		let workerCount = Math.min(Math.max(concurrency || 1, 1), targets.length)

		let worker = async () => {
			while (true) {
				let currentTargetIndex = nextIndex++
				if (currentTargetIndex >= targets.length) return
				let chunkIndex = targets[currentTargetIndex]
				let result = await this.translateChunkWithRetry({
					chunkText: chunks[chunkIndex],
					chunkIndex,
					totalChunks: chunks.length,
					autoRetryCount,
					translateChunk
				})
				if (result.ok) {
					successes.set(chunkIndex, result.translated)
				} else {
					failures.push(result)
				}
				completed++
				if (typeof onProgress === "function") {
					onProgress({
						completed,
						total: targets.length,
						chunkIndex,
						successes: successes.size,
						failures: failures.length
					})
				}
			}
		}

		await Promise.all(Array.from({ length: workerCount }, () => worker()))
		failures.sort((a, b) => a.chunkIndex - b.chunkIndex)
		return { successes, failures }
	},

	async callLLMForTranslation(text, language, llmSettings, chunkIndex, totalChunks) {
		let url = `${llmSettings.apiBaseURL}/chat/completions`

		let chunkHint = totalChunks > 1
			? `\n\nNote: This is part ${chunkIndex} of ${totalChunks}. Translate only this part, maintaining continuity.`
			: ""

		let systemPrompt = `You are a professional academic translator. Translate the following Markdown content into ${language}.

Rules:
- Preserve all Markdown formatting (headings, bold, italic, lists, code blocks, etc.)
- Preserve all mathematical formulas ($...$ and $$...$$) without translation
- Preserve all table structures
- Preserve all image references and links
- Translate only the natural language text
- Do not add explanations or notes
- Output only the translated Markdown content${chunkHint}`

		let payload = {
			model: llmSettings.model,
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: text }
			],
			temperature: 0.3
		}

		let doFetch = async () => {
			let response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Authorization": `Bearer ${llmSettings.apiKey}`
				},
				body: JSON.stringify(payload)
			})

			if (!response.ok) {
				let errText = await response.text()
				throw new Error(`LLM API 请求失败 ${response.status}: ${errText.slice(0, 500)}`)
			}

			let result = await response.json()
			let content = result?.choices?.[0]?.message?.content
			if (!content || !content.trim()) {
				throw new Error("LLM 返回内容为空")
			}
			return content.trim()
		}

		return await this.withTimeout(doFetch, 180000, "LLM 翻译请求")
	},

	async saveTranslationAsMarkdownAttachment({ parentItem, sourceAttachment, translatedText, language }) {
		let sourceTitle = sourceAttachment.getField("title")
			|| this.fileNameFromPath(sourceAttachment.getFilePath() || "document")
		let mdFileName = this.sanitizeFileName(`Translation (${language}) - ${sourceTitle}`)
		if (!mdFileName.endsWith(".md")) mdFileName += ".md"

		// Write .md to temp dir
		let tempDir = PathUtils.join(
			PathUtils.tempDir,
			`zotero-mineru-translate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
		)
		await IOUtils.makeDirectory(tempDir, { createAncestors: true })
		let mdTempPath = PathUtils.join(tempDir, mdFileName)
		let rewrittenText = this.rewriteTranslationImageLinksToSourceStorage(translatedText, sourceAttachment)
		await IOUtils.writeUTF8(mdTempPath, rewrittenText)

		try {
			let mdAttachment = await Zotero.Attachments.importFromFile({
				file: mdTempPath,
				libraryID: parentItem.libraryID,
				parentItemID: parentItem.id,
				contentType: "text/markdown",
				charset: "utf-8"
			})

			mdAttachment.addTag("#MinerU-Translation", 0)
			await mdAttachment.saveTx()

			this.log(`翻译附件已保存: ${mdFileName} (图片链接已指向源附件 ${sourceAttachment?.key || "unknown"})`)
		}
		finally {
			await IOUtils.remove(mdTempPath).catch(() => {})
			await IOUtils.remove(tempDir, { recursive: true }).catch(() => {})
		}
	}
};
