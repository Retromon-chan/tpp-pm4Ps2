"use strict";
const assert = require("node:assert/strict"), {test} = require("node:test"), fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path"), iconv = require("iconv-lite");
const keyboard = require("../pm4Ps2.keyboard.js"), codec = require("../pm4Ps2.images.js"), parser = require("../pm4Ps2.module.js"), {keyboardElf, iso, spd} = require("./fixtures.cjs");

test("English input tables match all displayed keys without touching executable instructions or row terminators", () => {
    const b = keyboardElf(), layout = keyboard.inspectExecutable(b), output = keyboard.patchExecutable(b), allowed = new Set();
    for (let page = 0; page < 2; page++) for (let row = 0; row < 6; row++) {
        for (let col = 0; col < 15; col++) {
            const offset = layout.tables[page].offset + row * 32 + col * 2;
            assert.equal(iconv.decode(output.subarray(offset, offset + 2), "cp932"), keyboard.nativeLetter(keyboard.PAGES[page][row][col]));
            allowed.add(offset); allowed.add(offset + 1);
        }
        assert.deepEqual(output.subarray(layout.tables[page].offset + row * 32 + 30, layout.tables[page].offset + row * 32 + 32), Buffer.alloc(2));
    }
    for (let i = 0; i < b.length; i++) if (!allowed.has(i)) assert.equal(output[i], b[i]);
    assert.equal(output.length, b.length);
    const key = (page, row, col) => output.subarray(layout.tables[page].offset + row * 32 + col * 2, layout.tables[page].offset + row * 32 + col * 2 + 2);
    assert.equal(iconv.decode(Buffer.concat([key(0, 0, 0), key(1, 0, 11), key(1, 0, 8), key(1, 0, 2), key(1, 0, 4)]), "cp932"), "Ａｌｉｃｅ");
});
test("unknown, ambiguous, non-MIPS and already-patched input tables are refused", () => {
    const b = keyboardElf(); assert.throws(() => keyboard.inspectExecutable(Buffer.alloc(1024)), /ELF/);
    const damaged = Buffer.from(b); damaged[256] ^= 1; assert.throws(() => keyboard.patchExecutable(damaged), /missing or ambiguous/);
    const duplicate = Buffer.concat([b, keyboard.tableBytes(keyboard.HIRAGANA)]); assert.throws(() => keyboard.patchExecutable(duplicate), /ambiguous/);
    assert.throws(() => keyboard.patchExecutable(keyboard.patchExecutable(b)), /missing/);
});
test("keyboard sheets preserve dimensions, sprite definitions and every pixel outside the key/caption regions", () => {
    const b = spd(640, 448), original = codec.decodeSpd(b), output = keyboard.patchKeyboardSheet(b, b, 0), image = codec.decodeSpd(output);
    assert.equal(output.length, b.length); assert.deepEqual(codec.parseSpd(output), codec.parseSpd(b));
    assert.deepEqual(image.data.subarray(0, 128 * 640 * 4), original.data.subarray(0, 128 * 640 * 4));
    assert.deepEqual(image.data.subarray(420 * 640 * 4), original.data.subarray(420 * 640 * 4));
    const tiles = codec.parseSpd(b).tiles;
    for (let i = 0; i < b.length; i++) if (!tiles.some(t => i >= t.offset && i < t.offset + t.size)) assert.equal(output[i], b[i]);
    assert.throws(() => keyboard.patchKeyboardSheet(spd(4, 4), spd(4, 4), 0), /640 x 448/);
});
test("Inject switch is a default-off flipswitch and accepts only an explicit boolean opt-in", () => {
    const fields = keyboard.injectOptionFields(); assert.equal(fields.schema.pm4EnglishKeyboard.default, false);
    assert.equal(fields.form[0].fieldHtmlClass, "flipSwitch");
    for (const options of [{}, {englishKeyboard: false}, {englishKeyboard: "false"}, {custom: {pm4EnglishKeyboard: "true"}}]) assert.equal(keyboard.isEnabled(options), false);
    assert.equal(keyboard.isEnabled({custom: {pm4EnglishKeyboard: true}}), true);
    assert.equal(keyboard.isEnabled({englishKeyboard: true, custom: {pm4EnglishKeyboard: false}}), false);
});
test("ISO opt-in patches only both keyboard sheets and input tables; off stays byte-identical", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pm4-keyboard-test-"));
    try {
        const source = path.join(root, "source.iso"), original = iso({keyboard: true}); await fs.writeFile(source, original);
        const manifest = await parser.inspectIso(source); manifest.isoSha256 = await parser.hashFile(source);
        const off = path.join(root, "off.iso"); await parser.exportIso(source, off, {manifest, custom: {pm4EnglishKeyboard: false}});
        assert.deepEqual(await fs.readFile(off), original);
        const on = path.join(root, "on.iso"), result = await parser.exportIso(source, on, {manifest, custom: {pm4EnglishKeyboard: true}});
        assert.deepEqual(result.patchedFiles.sort(), [...keyboard.RESOURCES].sort());
        const output = await fs.readFile(on), inspected = await parser.inspectIso(source, {includeKeyboard: true});
        for (const rec of inspected.keyboardResources) {
            const input = original.subarray(rec.offset, rec.offset + rec.size), actual = output.subarray(rec.offset, rec.offset + rec.size);
            const expected = rec.name === "SLPM_659.36" ? keyboard.patchExecutable(input) : keyboard.patchKeyboardSheet(input, input, rec.name === "ENTRY2A.SPD" ? 0 : 1);
            assert.deepEqual(actual, expected);
        }
        for (let i = 0; i < original.length; i++) if (!inspected.keyboardResources.some(r => i >= r.offset && i < r.offset + r.size)) assert.equal(output[i], original[i]);
        assert.deepEqual(await fs.readFile(source), original);
    } finally { await fs.rm(root, {recursive: true, force: true}); }
});
