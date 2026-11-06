var ZoteroMineru;

function log(msg) {
	Zotero.debug("Zotero MinerU: " + msg);
}

function ensureAbortController(win) {
	if (typeof AbortController === "undefined") {
		let targetWin = win || (typeof Zotero !== "undefined" && (Zotero.getMainWindow?.() || Zotero.getMainWindows?.()?.[0]))
			|| (typeof Services !== "undefined" && (Services.wm?.getMostRecentWindow?.("navigator:browser") || Services.wm?.getMostRecentWindow?.(null)));
		if (targetWin && targetWin.AbortController) {
			try {
				globalThis.AbortController = targetWin.AbortController;
			} catch (_) {}
		}
	}
}

function install() {
	log("Installed");
}

async function startup({ id, version, rootURI }) {
	log("Starting " + version);
	ensureAbortController();
	
	try {
		let prefPaneCandidates = [
			{
				pluginID: id,
				src: rootURI + "preferences.xhtml",
				scripts: [rootURI + "preferences.js"],
				stylesheets: [rootURI + "preferences.css"],
				label: "MinerU",
				image: rootURI + "icon.svg"
			},
			{
				pluginID: id,
				src: "preferences.xhtml",
				scripts: [rootURI + "preferences.js"],
				stylesheets: [rootURI + "preferences.css"],
				label: "MinerU",
				image: "icon.svg"
			},
			{
				pluginID: id,
				src: "preferences.xhtml",
				label: "MinerU",
				image: "icon.svg"
			}
		];
		let prefRegistered = false;
		for (let options of prefPaneCandidates) {
			try {
				Zotero.PreferencePanes.register(options);
				prefRegistered = true;
				break;
			}
			catch (e) {
				log(`Preference pane registration attempt failed: ${e}`);
			}
		}
		if (!prefRegistered) {
			throw new Error("All preference pane registration attempts failed");
		}
	}
	catch (e) {
		log(`Preference pane registration failed: ${e}`);
		Zotero.logError(e);
	}
	
	Services.scriptloader.loadSubScript(rootURI + 'mineru.js');
	ZoteroMineru.init({ id, version, rootURI });
	ZoteroMineru.addToAllWindows();
	await ZoteroMineru.main();
}

function onMainWindowLoad({ window }) {
	ensureAbortController(window);
	ZoteroMineru.addToWindow(window);
}

function onMainWindowUnload({ window }) {
	ZoteroMineru.removeFromWindow(window);
}

function shutdown() {
	log("Shutting down");
	ZoteroMineru.removeFromAllWindows();
	ZoteroMineru = undefined;
}

function uninstall() {
	log("Uninstalled");
}
