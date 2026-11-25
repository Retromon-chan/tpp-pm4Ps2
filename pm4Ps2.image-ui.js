"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const codec = require("./pm4Ps2.images.js");
const parser = require("./pm4Ps2.module.js");
const keyboard = require("./pm4Ps2.keyboard.js");
const digest = b => crypto.createHash("sha256").update(b).digest("hex");
function installRenderer(it) {
    if (!it?.renderToCanvas || it.pm4RendererHook) return;
    const render = it.renderToCanvas;
    it.renderToCanvas = function(canvas, file, options) {
        if (!file?.pm4Image) return render.call(this, canvas, file, options);
        // The generic image editor draws a mask even for an empty target.
        // On a game sheet blank translations must leave those pixels intact.
        const parameters = (file.parameters || []).map((p, row) => it.getBestTranslation(file.data?.[row]) ? p : []);
        return render.call(this, canvas, {...file, parameters}, options);
    };
    it.pm4RendererHook = true;
}

module.exports = function install(addon, {trans, ui, common, addonLoader, OcrEngine, $}) {
    if (addon.imageSupportInstalled) return;
    addon.imageSupportInstalled = true;
    function imageTranslator() {
        wireImageTranslator();
        const it = addonLoader.getAddonByName("imageTranslator");
        if (!it?.buildImageFileEntry || !it.renderImageToBuffer) throw new Error("Enable the Image Translator add-on to edit PM4 images.");
        return it;
    }
    function currentProject() {
        if (trans.project?.gameEngine !== "pm4Ps2") throw new Error("Open a Princess Maker 4 PS2 project first.");
    }
    function imageEntries(data, options = {}) {
        return Object.entries({...data.project.files, ...options.imageTranslatorFiles}).filter(([, f]) => f.type === "image" && f.pm4Image);
    }
    function hasText(file) { return file.layerVisibility?.texts !== false && file.data?.some(row => row?.slice(1).some(Boolean)); }
    function hasEdits(file) {
        return hasText(file) || file.layerVisibility?.original === false ||
            ["inpaint", "krita", "aiInpaint", "burnIn"].some(name => file[name + "Layer"]?.imageStagingPath && file.layerVisibility?.[name] !== false);
    }
    async function renderedPng(file) {
        const it = imageTranslator(), layers = it.getImageLayerVisibility(file);
        // A full-sheet replacement needs no canvas blending. This preserves
        // hidden RGB and the exact alpha of a PNG-to-SPD no-op round trip.
        if (!layers.original && layers.krita && !layers.inpaint && !layers.aiInpaint && !layers.burnIn && !hasText(file)) {
            return fs.promises.readFile(it.getKritaLayerAbsPath(file));
        }
        return it.renderImageToBuffer(file);
    }
    addon.addImageResources = async function(data, options = {}) {
        const it = imageTranslator(), init = data.project.options.init, cache = trans.getStagingPath(data);
        const extraction = await parser.extractImages(init.entryPoint, path.join(cache, "images", "pm4"), {expectedSha256: init.sourceManifest.isoSha256});
        const existing = new Map(imageEntries(data).map(([id, f]) => [f.pm4Image.resourceName, id]));
        const jobs = extraction.files.filter(record => !existing.has(record.name));
        const engine = options.ocr === false ? null : OcrEngine.getMainEngine();
        if (options.ocr !== false && !engine) throw new Error("No OCR engine is available. Disable Recognize image text to import editable sheets without OCR.");
        const added = [], failures = [];
        const process = async (record, i, recognize) => {
            ui.log("Image " + (i + 1) + "/" + jobs.length + ": " + record.name);
            let blocks = [];
            if (engine) {
                try { blocks = await it.translateImageAsset(await fs.promises.readFile(record.pngPath), {engineId: engine.id, recognize}); }
                catch (error) { failures.push({name: record.name, error: error.message}); ui.log.error("OCR failed for " + record.name + ": " + error.message + ". The editable sheet is still imported."); }
            }
            const relative = "images/pm4/" + path.basename(record.pngPath);
            const file = it.buildImageFileEntry(relative, blocks, {width: record.width, height: record.height,
                engineId: engine?.id, stagingPath: relative, sourceExtension: ".png", originalFormat: "PM4 PS2 SPD / TIM2 RGBA32"});
            file.pm4Image = {resourceName: record.name, originalPixelSha256: record.pixelSha256};
            // Keep even empty OCR results: a picture can be painted manually.
            data.project.files[file.path] = file; added.push(file.path);
        };
        if (engine) await it.runOcrJobs(jobs, engine, {ocrWorkerCount: 2}, process);
        else for (let i = 0; i < jobs.length; i++) await process(jobs[i], i);
        init.sourceManifest.imageResources = extraction.manifest.imageResources;
        init.includeImages = true; init.ocrImages = options.ocr !== false;
        return {added, failures, count: extraction.files.length};
    };
    addon.importGameImages = async function(options = {}) {
        currentProject(); ui.showLoading();
        try {
            const data = {project: trans.project}, result = await addon.addImageResources(data, options);
            for (const id of result.added) trans.addFileToNavigator(id, trans.project.files[id]);
            trans.reindexFileNavigator(); trans.evalTranslationProgress(result.added); trans.gridIsModified(true);
            return result;
        } finally { ui.loadingEnd(); }
    };
    addon.exportEditableImages = async function(directory) {
        currentProject(); const entries = imageEntries({project: trans.project}), prepared = [];
        if (!entries.length) throw new Error("Use Add game images to this project first.");
        await fs.promises.mkdir(directory, {recursive: true});
        for (const [, file] of entries) {
            const target = path.join(directory, file.pm4Image.resourceName.replace(/\.SPD$/, ".png"));
            if (fs.existsSync(target)) throw new Error("PNG already exists; choose an empty folder: " + target);
            const png = hasEdits(file) ? await renderedPng(file) : await fs.promises.readFile(imageTranslator().getImageAbsPath(file));
            codec.decodePng(png); prepared.push({target, png});
        }
        for (const {target, png} of prepared) await fs.promises.writeFile(target, png, {flag: "wx"});
        return prepared.map(p => p.target);
    };
    addon.importEditedImages = async function(directory) {
        currentProject(); const it = imageTranslator(), entries = imageEntries({project: trans.project});
        const byName = new Map(entries.map(([id, f]) => [f.pm4Image.resourceName.replace(/\.SPD$/, ".png").toLowerCase(), {id, file: f}]));
        const names = (await fs.promises.readdir(directory)).filter(name => /\.png$/i.test(name));
        if (!names.length) throw new Error("No edited PNGs found in this folder.");
        const prepared = [];
        // Validate the complete batch before importing any file.
        for (const name of names) {
            const entry = byName.get(name.toLowerCase()); if (!entry) throw new Error("PNG does not match an imported PM4 sheet: " + name);
            const png = await fs.promises.readFile(path.join(directory, name)), image = codec.decodePng(png);
            if (image.width !== entry.file.imageWidth || image.height !== entry.file.imageHeight) throw new Error(name + ": preserve dimensions " + entry.file.imageWidth + " x " + entry.file.imageHeight + ".");
            const relative = it.getKritaRelativePath(entry.id), target = path.join(trans.getStagingPath(), relative);
            prepared.push({...entry, png, relative, target});
        }
        for (const {id, file, png, relative, target} of prepared) {
            it.stopKritaSession?.(id); await fs.promises.mkdir(path.dirname(target), {recursive: true});
            if (fs.existsSync(target)) await fs.promises.copyFile(target, target + "." + Date.now() + ".bak", fs.constants.COPYFILE_EXCL);
            await fs.promises.writeFile(target, png);
            file.kritaLayer = {imageStagingPath: relative, createdAt: file.kritaLayer?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), revision: (file.kritaLayer?.revision || 0) + 1};
            file.layerVisibility = {...file.layerVisibility, original: false, krita: true};
            file.pm4Image.importedPngSha256 = digest(png);
            await it.importKritaLayerFromDisk(id);
        }
        trans.gridIsModified(true); return prepared.map(p => p.id);
    };
    // Krita starts from a full copy of the original. On PM4 sheets it replaces
    // the base layer, avoiding doubled alpha on translucent sprite borders.
    function wireImageTranslator() {
        const it = addonLoader.getAddonByName("imageTranslator"); installRenderer(it);
        if (it?.createKritaLayer && !it.pm4KritaHook) {
            const create = it.createKritaLayer;
            it.createKritaLayer = async function(id, options) {
                const result = await create.call(this, id, options), file = trans.project?.files?.[id];
                if (file?.pm4Image) file.layerVisibility = {...file.layerVisibility, original: false, krita: true};
                return result;
            };
            it.pm4KritaHook = true;
        }
    }
    wireImageTranslator(); addonLoader.onReady?.(wireImageTranslator);
    const finalize = addon.finalizeTransData;
    addon.finalizeTransData = async function(data, base, options) {
        data = await finalize.call(addon, data, base, options);
        if (options.init.includeImages) await addon.addImageResources(data, {ocr: options.init.ocrImages !== false});
        return data;
    };
    const update = addon.updateProject;
    if (update) addon.updateProject = async function(...args) {
        const previous = trans.getSaveData(), previousProject = trans.project, previousCache = trans.getStagingPath(previous);
        const result = await update.apply(addon, args);
        if (trans.project === previousProject) return result; // cancelled
        const nextCache = trans.getStagingPath(), copied = new Set();
        function asset(root, relative) {
            const target = path.resolve(root, String(relative).replace(/^[\\/]+/, "")), rest = path.relative(path.resolve(root), target);
            if (!rest || rest === ".." || rest.startsWith(".." + path.sep) || path.isAbsolute(rest)) throw new Error("Image layer path escapes project staging.");
            return target;
        }
        async function copyLayerFiles(value) {
            if (!value || typeof value !== "object") return;
            for (const [key, item] of Object.entries(value)) {
                if (/StagingPath$/.test(key) && typeof item === "string" && item && !copied.has(item)) {
                    const source = asset(previousCache, item), target = asset(nextCache, item);
                    await fs.promises.mkdir(path.dirname(target), {recursive: true});
                    if (fs.existsSync(target)) {
                        if (!(await fs.promises.readFile(source)).equals(await fs.promises.readFile(target))) throw new Error("Conflicting staged image layer: " + item);
                    } else await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL);
                    copied.add(item);
                } else if (item && typeof item === "object") await copyLayerFiles(item);
            }
        }
        for (const [id, oldFile] of imageEntries(previous)) {
            const file = trans.project.files[id]; if (!file?.pm4Image) continue;
            if (file.pm4Image.originalPixelSha256 !== oldFile.pm4Image.originalPixelSha256) {
                ui.log.error("Image source changed; review prior edits in the saved previous project: " + id); continue;
            }
            for (const key of ["kritaLayer", "inpaintLayer", "aiInpaintLayer", "burnInLayer", "aiInpaint"]) await copyLayerFiles(oldFile[key]);
            // Keep drawn boxes, styles, OCR corrections and all image layers.
            for (const key of ["data", "context", "parameters", "tags", "comments", "cellInfo", "indexIds", "layerVisibility", "kritaLayer", "inpaintLayer", "aiInpaintLayer", "burnInLayer", "aiInpaint", "pm4Image"]) {
                if (oldFile[key] !== undefined) file[key] = JSON.parse(JSON.stringify(oldFile[key]));
            }
        }
        trans.gridIsModified(true); trans.refreshGrid?.(); return result;
    };
    addon.exportToFolder = async function(directory, data, options = {}) {
        data ||= trans.getSaveData(); const init = data.project.options.init;
        const translationDatas = options.translationDatas || trans.getTranslationData(data, options);
        const files = options.files?.length ? options.files : trans.getAllFiles(data, true);
        const translations = {}, images = {};
        for (const file of files) {
            const name = file.replace(/^[\\/]+/, "");
            if (init.sourceManifest.resources.some(r => r.name === name)) translations[name] = addon.selectTranslationData(translationDatas, file);
        }
        const selected = options.files?.length ? new Set(options.files) : null;
        for (const [id, file] of imageEntries(data, options)) {
            if (selected && !selected.has(id)) continue;
            if (hasEdits(file)) images[file.pm4Image.resourceName] = await renderedPng(file);
        }
        const stem = path.basename(init.entryPoint, path.extname(init.entryPoint)) + ".translated";
        let output = path.join(directory, stem + ".iso"), version = 2;
        while (fs.existsSync(output)) output = path.join(directory, stem + "-" + version++ + ".iso");
        ui.log("Validating text and images, then exporting a separate ISO...");
        const englishKeyboard = keyboard.isEnabled(options);
        if (englishKeyboard) ui.log("Applying the English name-entry keyboard (uppercase/lowercase letters and numbers).");
        const result = await parser.exportIso(init.entryPoint, output, {manifest: init.sourceManifest, translations, images, englishKeyboard});
        // Image Translator hides these files during Inject. They are already
        // inside our ISO and must not subsequently be written as loose PNGs.
        options.imageTranslatorHandled = true;
        ui.log("Exported " + result.path + "; changed resources: " + (result.patchedFiles.join(", ") || "none"));
        return [result.path];
    };
    ui.onReady(() => {
        wireImageTranslator();
        ui.mainMenu.addChild("tools", {id: "pm4Ps2Images", label: "Princess Maker 4 (PS2)"});
        function action(label, fn) {
            ui.mainMenu.addChild("pm4Ps2Images", {label}).on("select", async () => {
                try { await fn(); } catch (error) { ui.log.error(error.stack || error.message); ui.alert(error.message); }
            });
        }
        action("Add game images to this project...", async () => {
            const result = await addon.importGameImages({ocr: true}); ui.log("Imported " + result.added.length + " PM4 image sheets.");
        });
        action("Export PNGs for editing...", async () => { currentProject(); const dir = await ui.openFileDialog({dir: true}); if (dir) await addon.exportEditableImages(dir); });
        action("Import edited PNGs...", async () => { currentProject(); const dir = await ui.openFileDialog({dir: true}); if (dir) { const ids = await addon.importEditedImages(dir); ui.log("Re-imported " + ids.length + " edited PM4 sheet(s). Export or Inject to apply them to the ISO."); } });
    });
};
module.exports.installRenderer = installRenderer;
