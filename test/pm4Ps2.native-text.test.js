"use strict";

const assert = require("node:assert/strict");
const {test} = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const iconv = require("iconv-lite");
const parser = require("../pm4Ps2.module.js");
const keyboard = require("../pm4Ps2.keyboard.js");
const {keyboardElf, iso} = require("./fixtures.cjs");

const name = "SLPM_659.36";
const dateAt = 0x18c160, promptAt = 0x18ca60;
const date = "%d年%2d月%2d日", prompt = "データをロードしますか？";

test("native UI translation preserves executable slots and composes with the keyboard", t => {
    const original = Buffer.alloc(0x18d300);
    keyboardElf().copy(original);
    for (const [offset, source] of [[dateAt, date], [promptAt, prompt]]) iconv.encode(source, "cp932").copy(original, offset);
    original.fill(0xcc, 0x18ca79, 0x18ca80);
    assert.throws(() => parser.dataset(original, name), /original SLPM/);
    // Use synthetic strings and an in-process stand-in for the retail hash.
    t.mock.method(keyboard, "isOriginalExecutable", b => b === original);
    const extracted = parser.dataset(original, name);
    const row = extracted.data.findIndex(([text]) => text === date);
    assert.equal(extracted.parameters[row][0].maxBytes, 14);
    assert.match(extracted.parameters[row][0].rowInfoText, /daughter and father/);
    assert.deepEqual(parser.rebuildResource(original, name), original);
    const context = extracted.context[extracted.data.findIndex(([text]) => text === prompt)][0];
    const withText = parser.rebuildResource(original, name, {translationPair: {
        [date]: "%d-%02d-%02d", [prompt]: "Read save data?", [context + "\n" + prompt]: "Load save data?"
    }});
    const expected = Buffer.from(original);
    expected.fill(0, dateAt, dateAt + 15).write("%d-%02d-%02d", dateAt, "ascii");
    expected.fill(0, promptAt, promptAt + iconv.encode(prompt, "cp932").length + 1).write("Load save data?", promptAt, "ascii");
    assert.deepEqual(withText, expected);
    const combined = keyboard.patchExecutable(original, false, withText);
    assert.deepEqual(combined.subarray(dateAt), expected.subarray(dateAt));
    assert.notDeepEqual(combined.subarray(0, dateAt), original.subarray(0, dateAt));
    const issues = parser.validateResource(original, name, {translationPair: {
        [date]: "%d-%d-%n", [prompt]: "A very long load confirmation that exceeds the Japanese slot."
    }});
    assert.match(issues[0].message, /three decimal placeholders/);
    assert.match(issues[1].message, /maximum is/);
    assert.match(parser.validateResource(original, name, {translationPair: {[prompt]: "Load\nnow?"}})[0].message, /number of lines/);
    assert.match(parser.validateResource(original, name, {translationPair: {[prompt]: "Load\0now?"}})[0].message, /control characters/);
});

test("item-list text capacity patch guards the instruction and composes with native UI text and keyboard in ISO export", async t => {
    const {offset, original: origInsn, expanded: newInsn} = parser.ITEM_LIST_CAPACITY;
    const elf = Buffer.alloc(0x18d300);
    keyboardElf().copy(elf);
    for (const [at, source] of [[dateAt, date], [promptAt, prompt]]) iconv.encode(source, "cp932").copy(elf, at);
    elf.writeUInt32LE(origInsn, offset);

    assert.throws(() => parser.patchItemListCapacity(elf), /original SLPM/);
    t.mock.method(keyboard, "isOriginalExecutable", b => b.equals(elf));
    const bad = Buffer.from(elf); bad.writeUInt32LE(0, offset);
    assert.throws(() => {
        t.mock.method(keyboard, "isOriginalExecutable", b => b.equals(bad));
        parser.patchItemListCapacity(bad);
    }, /item-list text capacity/);
    t.mock.method(keyboard, "isOriginalExecutable", b => b.equals(elf));

    const expanded = parser.patchItemListCapacity(elf);
    assert.equal(expanded.readUInt32LE(offset), newInsn);
    for (let i = 0; i < elf.length; i++) if (i < offset || i >= offset + 4) assert.equal(expanded[i], elf[i]);

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pm4-item-pool-"));
    try {
        const source = path.join(root, "source.iso");
        await fs.writeFile(source, iso({keyboard: true, elf}));
        const scanned = await parser.pm4Ps2Project.scan(source, {stagingDir: path.join(root, "stage")});
        const elfRecord = scanned.manifest.resources.find(r => r.name === name);
        assert.ok(elfRecord);

        // Translating ITEM_NAM.TXT expands the item-list capacity and composes with native UI text and keyboard.
        const out = path.join(root, "items.iso");
        const res = await parser.exportIso(source, out, {
            manifest: scanned.manifest,
            englishKeyboard: true,
            translations: {
                "ITEM_NAM.TXT": {translationPair: {"剣": "Practice Sword", "盾": "Martial Outfit"}},
                [name]: {translationPair: {[prompt]: "Load save data?"}}
            }
        });
        assert.ok(res.patchedFiles.includes(name) && res.patchedFiles.includes("ITEM_NAM.TXT"));
        const outElf = (await fs.readFile(out)).subarray(elfRecord.offset, elfRecord.offset + elfRecord.size);
        assert.equal(outElf.readUInt32LE(offset), newInsn);
        assert.equal(outElf.subarray(promptAt, promptAt + 15).toString("ascii"), "Load save data?");
        assert.notDeepEqual(outElf.subarray(256, 256 + 192), elf.subarray(256, 256 + 192));

        // Legacy manifests without SLPM_659.36 still discover and patch it when ITEM_NAM.TXT changes.
        const legacyManifest = {...scanned.manifest, resources: scanned.manifest.resources.filter(r => r.name !== name)};
        const legacyOut = path.join(root, "legacy.iso");
        await parser.exportIso(source, legacyOut, {
            manifest: legacyManifest,
            translations: {"ITEM_NAM.TXT": {translationPair: {"剣": "Practice Sword"}}}
        });
        const legacyElf = (await fs.readFile(legacyOut)).subarray(elfRecord.offset, elfRecord.offset + elfRecord.size);
        assert.equal(legacyElf.readUInt32LE(offset), newInsn);

        // expandTextWindows: false and dialogue-only exports keep SLPM_659.36 unchanged.
        const skipped = path.join(root, "skipped.iso");
        await parser.exportIso(source, skipped, {
            manifest: scanned.manifest,
            expandTextWindows: false,
            translations: {"ITEM_NAM.TXT": {translationPair: {"剣": "Practice Sword"}}}
        });
        assert.equal((await fs.readFile(skipped)).subarray(elfRecord.offset, elfRecord.offset + elfRecord.size).readUInt32LE(offset), origInsn);

        const dialogueOnly = path.join(root, "dialogue.iso");
        await parser.exportIso(source, dialogueOnly, {
            manifest: scanned.manifest,
            translations: {"ROOM.G2": {translationPair: {"はい": "Yes"}}}
        });
        assert.equal((await fs.readFile(dialogueOnly)).subarray(elfRecord.offset, elfRecord.offset + elfRecord.size).readUInt32LE(offset), origInsn);
    } finally { await fs.rm(root, {recursive: true, force: true}); }
});
