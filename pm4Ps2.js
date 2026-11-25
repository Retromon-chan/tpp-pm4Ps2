// Addon.loadJS executes this with the Addon instance as top-level `this`.
const thisAddon = this;
const nwPath = require("path");
const fs = require("fs");
const AddonUtils = require("www/js/AddonUtils.js");
const parser = require(nwPath.join(thisAddon.getPathRelativeToRoot(), "pm4Ps2.module.js"));
const parserTitle = "Princess Maker 4 (PS2)";
thisAddon.gameEngine = "pm4Ps2";
thisAddon.originalResourceIsReadOnly = true;
AddonUtils(thisAddon);
thisAddon.alwaysExportFromStage = true;
const supportedEngines = [thisAddon.gameEngine];

function resourcePath(root, fileId) {
    const name = fileId.replace(/^[\\/]+/, "");
    if (!/^(ROOM\.G2|PRIME4\.G2|ITEM_NAM\.TXT|ITEM_MSG\.TXT|TEST\.G2|DEVTEST\.G2)$/.test(name)) throw new Error("Invalid PM4 resource: " + fileId);
    return nwPath.join(root, name);
}
thisAddon.prepareNewProject = async function(info = {}) {
    if (!info.entryPoint) throw new Error("Choose the Japanese PS2 ISO first.");
    ui.showLoading();
    let scanned;
    try {
        ui.log("Reading the PS2 disc and checking its checksum. The original ISO is kept unchanged.");
        scanned = await parser.pm4Ps2Project.scan(nwPath.resolve(info.entryPoint), {init: info});
        const init = {entryPoint: scanned.isoPath, includeTestScripts: Boolean(info.includeTestScripts),
            includeImages: info.includeImages !== false, ocrImages: info.ocrImages !== false,
            projectTitle: info.projectTitle || parserTitle, sourceManifest: scanned.manifest};
        return await thisAddon.createProject(scanned.files, scanned.sourceDir, {init});
    } finally {
        if (scanned) {
            // Only the private temporary directory returned by scan(), never a game path.
            for (const file of scanned.files) await fs.promises.unlink(resourcePath(scanned.sourceDir, file)).catch(() => {});
            await fs.promises.rmdir(scanned.sourceDir).catch(() => {});
        }
        ui.loadingEnd();
    }
};
thisAddon.getTransData = async function(file, basePath) { return parser.parseFile(resourcePath(basePath, file)); };
thisAddon.writeFile = async function(file, basePath, targetDir, options = {}) {
    const selected = thisAddon.selectTranslationData(options.translationDatas, file);
    return parser.writeFile(resourcePath(basePath, file), resourcePath(targetDir, file), selected);
};
thisAddon.setFileFormatName = async file => /\.G2$/i.test(file) ? "PM4 PS2 G2CD0460 bytecode (CP932)" : "PM4 PS2 item list (CP932)";
thisAddon.setProjectLocation = async (_data, _base, options) => nwPath.dirname(options.init.entryPoint);
thisAddon.finalizeTransData = async function(data) {
    data.project.options.sl = "ja";
    data.project.options.tl = "en";
    data.project.options.gridInfo = {rowHeaderWidth: 240, ...data.project.options.gridInfo, isRuleActive: true, rowHeaderInfo: true};
    return data;
};

// A disc is the export unit. Copy once and patch selected resource extents in
// that copy. Never copy the whole source directory during Inject.
thisAddon.exportToFolder = async function(destinationDir, transData, options = {}) {
    transData ||= trans.getSaveData();
    const init = transData.project.options.init;
    const translationDatas = options.translationDatas || trans.getTranslationData(transData, options);
    const files = options.files?.length ? options.files : trans.getAllFiles(transData, true);
    const translations = {};
    for (const file of files) {
        const name = file.replace(/^[\\/]+/, "");
        if (!init.sourceManifest.resources.some(r => r.name === name)) continue;
        translations[name] = thisAddon.selectTranslationData(translationDatas, file);
    }
    const stem = nwPath.basename(init.entryPoint, nwPath.extname(init.entryPoint)) + ".translated";
    let output = nwPath.join(destinationDir, stem + ".iso"), version = 2;
    while (fs.existsSync(output)) output = nwPath.join(destinationDir, stem + "-" + version++ + ".iso");
    ui.log("Validating translations and exporting a separate ISO. This can take a moment.");
    const result = await parser.exportIso(init.entryPoint, output, {manifest: init.sourceManifest, translations});
    ui.log("Exported " + result.path + "; changed resources: " + (result.patchedFiles.join(", ") || "none"));
    return [result.path];
};
thisAddon.injectCopyMaterials = async function() { /* The ISO writer copies the disc once. */ };
thisAddon.exportAsZip = async function(targetPath, transData, options = {}) {
    const source = (transData || trans.getSaveData()).project.options.init.entryPoint;
    if (nwPath.resolve(targetPath).toLowerCase() === nwPath.resolve(source).toLowerCase()) throw new Error("Cannot overwrite the source ISO.");
    const root = await fs.promises.mkdtemp(nwPath.join(require("os").tmpdir(), "tpp-pm4-zip-"));
    try {
        await thisAddon.exportToFolder(root, transData, options);
        await new Promise((resolve, reject) => require("7zip-min").cmd(["a", "-tzip", targetPath, nwPath.join(root, "*")],
            error => error ? reject(error) : resolve()));
        return targetPath;
    } finally {
        for (const name of await fs.promises.readdir(root)) await fs.promises.unlink(nwPath.join(root, name));
        await fs.promises.rmdir(root);
    }
};
thisAddon.handleExport = async function(targetPath, options = {}) {
    ui.showLoading();
    try {
        if (options.mode === "zip") await thisAddon.exportAsZip(targetPath, undefined, options);
        else await thisAddon.exportToFolder(targetPath, undefined, options);
        ui.log("Export completed: " + targetPath);
        await ui.log.showOpenDirButton(targetPath);
    } finally { ui.loadingEnd(); }
};

thisAddon.registerProjectWizard = function() {
    const $slide = $("<div><h2>Princess Maker 4 (PS2)</h2><p>Open the Japanese PS2 ISO (SLPM_659.36). Import dialogue, choices, item text, and editable interface image sheets. Export or Inject creates a separate translated ISO.</p><p>Text translations must fit the original CP932 byte budgets and preserve line counts and % codes. Image sheets keep their original dimensions. Fonts are not edited.</p><div class='parserFields'></div></div>");
    ui.newProjectDialog.addMenu({
        icon: thisAddon.getWebLocation() + "/icon.png", descriptionBar: "<h2>Princess Maker 4 (PS2)</h2>", actionBar: "",
        goToSlide: thisAddon.package.name, at: 8,
        slides: {parser: ui.newProjectDialog.newSlide(thisAddon.package.name, $slide, {
            buttons: [{text: t("Create Project"), click: async function() {
                try {
                    await thisAddon.prepareNewProject(thisAddon.projectField?.getValues()); ui.newProjectDialog.close();
                } catch (error) { ui.log.error(error.stack || String(error)); alert(error.message); }
            }}],
            onActive: () => {
                thisAddon.projectField = new CustomFields($("<form></form>"), {jsonForm: {
                    schema: {
                        entryPoint: {type: "string", title: "Japanese PS2 ISO", required: true},
                        projectTitle: {type: "string", title: "Project title", default: parserTitle},
                        includeImages: {type: "boolean", title: "Include editable interface images", default: true},
                        ocrImages: {type: "boolean", title: "Recognize image text with the configured OCR engine", default: true},
                        includeTestScripts: {type: "boolean", title: "Include TEST.G2 and DEVTEST.G2 (development scripts)", default: false}
                    },
                    form: [{key: "entryPoint", type: "selectfile", accept: ".iso"}, {key: "projectTitle"}, {key: "includeImages"}, {key: "ocrImages"}, {key: "includeTestScripts"}]
                }});
                $slide.find(".parserFields").empty().append(thisAddon.projectField.getElm());
            }
        })}
    });
};
thisAddon.registerEngineDetector = function() {
    const registry = window.engineDetectionRegistry;
    if (!registry || registry.definitions.has("pm4Ps2")) return;
    registry.register({
        id: "pm4Ps2", addonId: thisAddon.id || thisAddon.package.name, engineIds: supportedEngines, displayName: parserTitle, priority: 100,
        detect: async request => {
            const entryPoint = request.entryPoint || request.selectedPath;
            if (!entryPoint || !/\.iso$/i.test(entryPoint) || !await parser.detectpm4Ps2(entryPoint)) return {matches: []};
            return {matches: [{engineId: "pm4Ps2", confidence: 1, evidence: ["SLPM_659.36 with a readable PM4 script filesystem."],
                entryPoint, gameRoot: nwPath.dirname(entryPoint), preferredInput: "entryPoint"}]};
        },
        openProjectWizard: async (_candidate, launchContext) => {
            ui.newProjectDialog.gotoSlide(thisAddon.package.name, "engineDetectResult");
            registry.setFieldValue(thisAddon.projectField.getElm().find("[name='entryPoint']"), launchContext.entryPoint);
        }
    });
};
require(nwPath.join(thisAddon.getPathRelativeToRoot(), "pm4Ps2.image-ui.js"))(thisAddon, {trans, ui, common, addonLoader, OcrEngine, $});
$(document).ready(() => ui.onReady(() => {
    thisAddon.registerProjectWizard(); thisAddon.registerEngineDetector();
    AddonUtils.applyCommonHandlers(supportedEngines, thisAddon);
    engines.getEngine("pm4Ps2").addProperty("injectOptionFields",
        require(nwPath.join(thisAddon.getPathRelativeToRoot(), "pm4Ps2.keyboard.js")).injectOptionFields());
    engines.addHandler(supportedEngines, "onOpenInjectDialog", async function($dialog) { $dialog.find(".copyOptionsBlock").addClass("hidden"); });
    const $budget = $("<span class='pm4Ps2Budget toolbar-content hidden'></span>").css({alignItems: "center", whiteSpace: "nowrap", padding: "0 8px"})
        .attr("title", "Maximum CP932 bytes for the selected row. ASCII usually costs 1 byte, Japanese 2. Keep source line count and % codes. Shorter translations are space-padded.");
    $("#quickFind").parent().before($budget);
    trans.on("beforeProcessSelection", (_event, row) => {
        const physical = trans.toPhysicalRow(row);
        const parameters = trans.getSelectedObject()?.parameters?.[physical] || [];
        const budgets = parameters.map(p => p.byteLength).filter(Number.isFinite);
        const visible = trans.project?.gameEngine === "pm4Ps2" && budgets.length > 0;
        $budget.toggleClass("hidden", !visible);
        if (visible) $budget.text("Max: " + Math.min(...budgets) + " CP932 bytes");
    });
    trans.on("beforeSelectFile", () => $budget.addClass("hidden"));
}));
