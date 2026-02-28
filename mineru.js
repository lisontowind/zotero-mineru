ZoteroMineru = {
	id: null,
	version: null,
	rootURI: null,
	initialized: false,
	menuRegistered: false,
	popupListeners: new WeakMap(),
	
	PREF_BRANCH: "extensions.zotero-mineru.",
	CONTEXT_MENU_ID: "zotero-mineru-parse-pdf",
	
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

	registerMenuForZotero8() {
		if (!this.supportsMenuManager() || this.menuRegistered) return false;
		try {
			let iconURL = this.getMenuIconURL();
			Zotero.MenuManager.registerMenu({
				menuID: this.CONTEXT_MENU_ID,
				pluginID: this.id,
				target: "main/library/item",
				menus: [
					{
						menuType: "menuitem",
						label: "使用 MinerU 解析 PDF 并保存为笔记",
						l10nID: "zotero-mineru-menu-parse-pdf",
						icon: iconURL,
						iconURL,
						image: iconURL,
						onShowing: (_event, context) => {
							if (typeof context?.setEnabled === "function") {
								let selectedItems = Array.isArray(context?.items) ? context.items : [];
								context.setEnabled(this.collectPDFTasks(selectedItems).length > 0);
							}
						},
						onCommand: (_event, context) => {
							let window = context?.menuElem?.ownerGlobal
								|| Zotero.getMainWindows?.()?.[0]
								|| null;
							let selectedItems = Array.isArray(context?.items) ? context.items : null;
							this.handleParseCommand({ window, selectedItems }).catch((e) => {
								this.log(`Parse command failed: ${e}`);
								Zotero.logError(e);
								this.showAlert(window, "MinerU", `执行失败: ${e.message || e}`);
							});
						}
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
		if (doc.getElementById(this.CONTEXT_MENU_ID)) return;
		
		let menuitem = doc.createXULElement("menuitem");
		menuitem.id = this.CONTEXT_MENU_ID;
		menuitem.setAttribute("label", "使用 MinerU 解析 PDF 并保存为笔记");
		menuitem.setAttribute("class", "menuitem-iconic");
		menuitem.setAttribute("image", this.getMenuIconURL());
		menuitem.style.listStyleImage = `url("${this.getMenuIconURL()}")`;
		menuitem.addEventListener("command", () => {
			this.handleParseCommand({ window }).catch((e) => {
				this.log(`Parse command failed: ${e}`);
				Zotero.logError(e);
				this.showAlert(window, "MinerU", `执行失败: ${e.message || e}`);
			});
		});
		popup.appendChild(menuitem);
		
		let onPopupShowing = () => {
			let selectedItems = window.ZoteroPane?.getSelectedItems?.() || [];
			let tasks = this.collectPDFTasks(selectedItems);
			menuitem.disabled = !tasks.length;
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
		doc.getElementById(this.CONTEXT_MENU_ID)?.remove();
		let listenerData = this.popupListeners.get(window);
		if (listenerData) {
			listenerData.popup.removeEventListener("popupshowing", listenerData.onPopupShowing);
			this.popupListeners.delete(window);
		}
	},
	
	removeFromAllWindows() {
		if (this.supportsMenuManager() && this.menuRegistered) {
			try {
				Zotero.MenuManager.unregisterMenu(this.CONTEXT_MENU_ID);
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
	
	collectPDFTasks(selectedItems) {
		let tasks = [];
		let seenAttachmentIDs = new Set();
		
		let addTask = (attachment, parentItem) => {
			if (!attachment || seenAttachmentIDs.has(attachment.id)) return;
			if (!attachment.isPDFAttachment()) return;
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
					text: "写入笔记",
					percent: 85
				});
					await this.saveResultAsNote({
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

	async saveResultAsNote({ attachment, parentItem, parsedResult, settings }) {
		let attachmentTitle = attachment.getField("title")
			|| this.fileNameFromPath(attachment.getFilePath() || "PDF");
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
		await note.saveTx();
		let embeddedResult = await this.materializeEmbeddedImagesForNote({
			note,
			contentHTML,
			embeddedImages
		});
		let noteHTML = embeddedResult.contentHTML || "<p></p>";
		note.setNote(noteHTML);
		await note.saveTx();
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
				image.fileName,
				image.dataURI
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
				reject(new Error(`${label}超时`));
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

	replaceImageMarkerWithAttachment(html, marker, attachmentKey, mimeType, fileName, fallbackDataURI = "") {
		if (!html || !marker || !attachmentKey) return html;
		let escapedMarker = this.escapeRegExp(marker);
		let ext = this.guessImageExtension(mimeType, fileName);
		let src = fallbackDataURI || `attachments/${attachmentKey}.${ext}`;
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
	}
};
