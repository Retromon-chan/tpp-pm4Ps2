"use strict";
const assert = require("node:assert/strict"), {test} = require("node:test"), fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path");
const codec = require("../pm4Ps2.images.js"), parser = require("../pm4Ps2.module.js"), {spd, iso} = require("./fixtures.cjs");

test("multi-tile SPD sheet positions and all PS2 alpha levels survive a PNG round trip exactly", () => {
    const b = spd(), image = codec.decodeSpd(b);
    assert.equal(image.width, 517); assert.equal(image.height, 300);
    assert.equal(codec.parseSpd(b).tiles.length, 6);
    for (const [x, y] of [[0, 0], [255, 255], [256, 256], [516, 299]]) {
        assert.deepEqual([...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)],
            [x % 256, y % 256, (x + y) % 256, Math.round(((x + y) % 129) * 255 / 128)]);
    }
    const png = codec.encodePng(image), decoded = codec.decodePng(png);
    assert.deepEqual(decoded, image); assert.deepEqual(codec.rebuildSpd(b, decoded), b);
});
test("an edited pixel across a tile boundary changes only that native RGBA pixel", () => {
    const b = spd(), image = codec.decodeSpd(b), x = 256, y = 256;
    image.data.set([12, 34, 56, 255], (y * image.width + x) * 4);
    const out = codec.rebuildSpd(b, codec.decodePng(codec.encodePng(image)));
    const tile = codec.parseSpd(b).tiles.find(t => x >= t.x && y >= t.y && x < t.x + t.width && y < t.y + t.height);
    const offset = tile.offset + ((y - tile.y) * tile.width + x - tile.x) * 4;
    assert.deepEqual(out.subarray(offset, offset + 4), Buffer.from([12, 34, 56, 128]));
    assert.deepEqual(out.subarray(0, offset), b.subarray(0, offset)); assert.deepEqual(out.subarray(offset + 4), b.subarray(offset + 4));
});
test("wrong dimensions, corrupt PNGs, palette formats, malformed sprite sections and unsupported tiles fail", () => {
    const b = spd(4, 4), image = codec.decodeSpd(b);
    assert.throws(() => codec.rebuildSpd(b, {...image, width: 5}), /dimensions/);
    const png = codec.encodePng(image); png[png.length - 1] ^= 1; assert.throws(() => codec.decodePng(png), /checksum/);
    assert.throws(() => codec.decodePng(Buffer.from("not a PNG")), /PNG/);
    assert.throws(() => codec.parseSpd(b.subarray(0, -1)), /container/);
    const indexed = Buffer.from(b); indexed[48 + 16 + 19] = 5; assert.throws(() => codec.parseSpd(indexed), /RGBA32/);
    const overlap = Buffer.from(b); overlap.writeUInt32LE(48, 40); assert.throws(() => codec.parseSpd(overlap), /Overlapping/);
    const alpha = Buffer.from(b); alpha[48 + 16 + 48 + 3] = 129; assert.throws(() => codec.decodeSpd(alpha), /alpha/);
});
test("whole ISO image extraction and no-op/edited re-import preserve disc layout and unrelated bytes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pm4-image-test-"));
    try {
        const source = path.join(root, "original.iso"), original = iso({images: true}); await fs.writeFile(source, original);
        const extracted = await parser.extractImages(source, path.join(root, "pngs"));
        assert.equal(extracted.files.length, 1); assert.equal(extracted.files[0].name, "W_STAT1.SPD");
        const manifest = extracted.manifest; manifest.isoSha256 = await parser.hashFile(source);
        const png = await fs.readFile(extracted.files[0].pngPath), noOp = path.join(root, "no-op.iso");
        const unchanged = await parser.exportIso(source, noOp, {manifest, images: {"W_STAT1.SPD": png}});
        assert.deepEqual(unchanged.patchedFiles, []); assert.deepEqual(await fs.readFile(noOp), original);
        const image = codec.decodePng(png); image.data.set([255, 0, 0, 255], 0);
        const edited = path.join(root, "edited.iso");
        const result = await parser.exportIso(source, edited, {manifest, images: {"W_STAT1.SPD": codec.encodePng(image)}});
        assert.deepEqual(result.patchedFiles, ["W_STAT1.SPD"]);
        const output = await fs.readFile(edited), record = manifest.imageResources[0];
        assert.deepEqual(codec.decodeSpd(output.subarray(record.offset, record.offset + record.size)), image);
        assert.deepEqual(output.subarray(0, record.offset), original.subarray(0, record.offset));
        assert.deepEqual(output.subarray(record.offset + record.size), original.subarray(record.offset + record.size));
        const invalid = path.join(root, "invalid.iso"), wrong = codec.encodePng({width: 1, height: 1, data: Buffer.alloc(4)});
        await assert.rejects(parser.exportIso(source, invalid, {manifest, images: {"W_STAT1.SPD": wrong}}), /dimensions/);
        await assert.rejects(fs.stat(invalid), /ENOENT/);
        await assert.rejects(parser.exportIso(source, invalid, {manifest, images: {"UNKNOWN.SPD": png}}), /Unrecognized/);
        assert.deepEqual(await fs.readFile(source), original);
        // Re-extraction never silently overwrites a user's edited PNG.
        await fs.writeFile(extracted.files[0].pngPath, wrong);
        await assert.rejects(parser.extractImages(source, path.join(root, "pngs")), /different content/);
    } finally { await fs.rm(root, {recursive: true, force: true}); }
});
test("PNG re-import validates the complete batch before changing project layers", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pm4-image-ui-test-"));
    try {
        const file = name => ({type: "image", imageWidth: 4, imageHeight: 4, pm4Image: {resourceName: name + ".SPD"}});
        const a = file("W_STAT1"), b = file("W_STAT2"), trans = {project: {gameEngine: "pm4Ps2", files: {a, b}}};
        const addon = {finalizeTransData: async data => data};
        const it = {buildImageFileEntry() {}, renderImageToBuffer() {}, getKritaRelativePath(id) { return id + ".png"; }};
        require("../pm4Ps2.image-ui.js")(addon, {trans, ui: {onReady() {}}, addonLoader: {getAddonByName() { return it; }}});
        trans.getStagingPath = () => root;
        await fs.writeFile(path.join(root, "W_STAT1.png"), codec.encodePng(codec.decodeSpd(spd(4, 4))));
        await fs.writeFile(path.join(root, "W_STAT2.png"), codec.encodePng(codec.decodeSpd(spd(5, 4))));
        await assert.rejects(addon.importEditedImages(root), /preserve dimensions/);
        assert.equal(a.kritaLayer, undefined); assert.equal(b.kritaLayer, undefined);
        assert.equal((await fs.readdir(root)).includes("a.png"), false);
    } finally { await fs.rm(root, {recursive: true, force: true}); }
});
test("PM4 previews preserve untranslated boxes and leave other game images unchanged", () => {
    const it = {getBestTranslation: row => row?.[1] || "", renderToCanvas: (_canvas, file) => file};
    require("../pm4Ps2.image-ui.js").installRenderer(it);
    const parameters = [[{imageBox: {bbox: {x: 0}}}], [{imageBox: {bbox: {x: 1}}}]];
    const file = {pm4Image: {}, data: [["First", "Translated"], ["Second", ""]], parameters};
    const rendered = it.renderToCanvas(null, file);
    assert.deepEqual(rendered.parameters, [parameters[0], []]); assert.equal(file.parameters, parameters);
    assert.equal(parameters[1][0].imageBox.bbox.x, 1);
    const other = {data: file.data, parameters}; assert.equal(it.renderToCanvas(null, other), other);
});
test("project update preserves edited PNG layers, drawn boxes, styles and image translations", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pm4-image-update-"));
    try {
        const oldRoot = path.join(root, "old"), newRoot = path.join(root, "new");
        await fs.mkdir(path.join(oldRoot, "krita"), {recursive: true}); await fs.mkdir(newRoot);
        const png = codec.encodePng(codec.decodeSpd(spd(4, 4))); await fs.writeFile(path.join(oldRoot, "krita/edit.png"), png);
        await fs.mkdir(path.join(oldRoot, "burn-in")); await fs.writeFile(path.join(oldRoot, "burn-in/translated.png"), png);
        const oldFile = {type: "image", pm4Image: {resourceName: "W_STAT1.SPD", originalPixelSha256: "same"}, data: [["JP", "EN"]],
            parameters: [[{imageBox: {bbox: {x: 1, y: 2, width: 3, height: 4}, style: {color: "#fff"}}}]],
            kritaLayer: {imageStagingPath: "krita/edit.png"}, burnInLayer: {imageStagingPath: "burn-in/translated.png", targetLanguage:"fr"}, layerVisibility: {original: false, krita: true, burnIn: true}};
        const old = {cacheRoot: oldRoot, files: {image: oldFile}}, fresh = {cacheRoot: newRoot, files: {image: {type: "image", pm4Image: {...oldFile.pm4Image}, data: []}}};
        const trans = {project: old, getSaveData() { return JSON.parse(JSON.stringify({project: this.project})); }, getStagingPath(data) { return (data?.project || this.project).cacheRoot; }, gridIsModified() {}};
        const addon = {finalizeTransData: async data => data, updateProject: async () => { trans.project = fresh; }};
        const it = {buildImageFileEntry() {}, renderImageToBuffer() {}};
        require("../pm4Ps2.image-ui.js")(addon, {trans, ui: {onReady() {}}, addonLoader: {getAddonByName() { return it; }}});
        await addon.updateProject();
        assert.deepEqual(fresh.files.image.data, oldFile.data); assert.deepEqual(fresh.files.image.parameters, oldFile.parameters);
        assert.deepEqual(fresh.files.image.layerVisibility, oldFile.layerVisibility);
        assert.deepEqual(await fs.readFile(path.join(newRoot, "krita/edit.png")), png);
        assert.deepEqual(fresh.files.image.burnInLayer, oldFile.burnInLayer);
        assert.deepEqual(await fs.readFile(path.join(newRoot, "burn-in/translated.png")), png);
    } finally { await fs.rm(root, {recursive: true, force: true}); }
});

test("burn-in image translation exports into the ISO without requiring grid translations", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pm4-burn-in-export-"));
    try {
        const source = path.join(root, "original.iso"), original = iso({images:true}); await fs.writeFile(source, original);
        const extracted = await parser.extractImages(source, path.join(root,"pngs"));
        const manifest = extracted.manifest; manifest.isoSha256 = await parser.hashFile(source);
        const png = await fs.readFile(extracted.files[0].pngPath), image = codec.decodePng(png);
        image.data.set([255,0,0,255],0); const translated = codec.encodePng(image);
        const file = {type:"image",pm4Image:{resourceName:"W_STAT1.SPD"},data:[["JP",""]],burnInLayer:{imageStagingPath:"burn-in/result.png"},layerVisibility:{original:false,krita:true,burnIn:true},kritaLayer:{imageStagingPath:"krita/old.png"}};
        const project = {gameEngine:"pm4Ps2",options:{init:{entryPoint:source,sourceManifest:manifest}},files:{image:file}};
        const trans = {project}, addon = {finalizeTransData:async data=>data};
        let rendered=0;
        const it = {buildImageFileEntry(){},renderImageToBuffer:async()=>{rendered++;return translated;},getImageLayerVisibility:()=>({original:false,krita:true,burnIn:true})};
        require("../pm4Ps2.image-ui.js")(addon,{trans,ui:{onReady(){},log(){}},addonLoader:{getAddonByName:()=>it}});
        const options={files:["image"],translationDatas:{}};
        const [outputPath]=await addon.exportToFolder(root,{project},options);
        assert.equal(rendered,1); assert.equal(options.imageTranslatorHandled,true);
        const output=await fs.readFile(outputPath), record=manifest.imageResources[0];
        assert.deepEqual(codec.decodeSpd(output.subarray(record.offset,record.offset+record.size)),image);
        assert.deepEqual(output.subarray(0,record.offset),original.subarray(0,record.offset));
        assert.deepEqual(output.subarray(record.offset+record.size),original.subarray(record.offset+record.size));
    } finally {await fs.rm(root,{recursive:true,force:true});}
});
