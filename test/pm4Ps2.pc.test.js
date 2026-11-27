"use strict";

const assert = require("node:assert/strict");
const {test} = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {gce1, gcex, pcScript} = require("./fixtures.cjs");
const archives = require("../pm4Ps2.gcex.js");
const parser = require("../pm4Ps2.module.js");

async function gameFolder(script = pcScript()) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pm4-pc-test-"));
    await fs.writeFile(path.join(dir, "script"), script);
    await fs.writeFile(path.join(dir, "PM4.exe"), Buffer.from("MZ"));
    return dir;
}
function entry(b, name) {
    const archive = archives.parseArchive(b);
    return archives.unpackEntry(b, archive, archive.entries.find(e => e.name === name));
}
const byText = (data, text) => data.data.findIndex(row => row[0] === text);

test("GCEX: compressed block chains unpack, and rebuilds keep other entries byte for byte", () => {
    const text = Buffer.from("abcabcabcabc hello hello hello ".repeat(30) + "the end");
    const bytes = Buffer.from(Array.from({length: 700}, (_, i) => (i * 7) % 251));
    const b = gcex([["a.txt", text], ["b.bin", bytes], ["c.txt", Buffer.from("x")]], {blockSize: 100});
    const archive = archives.parseArchive(b);
    assert.deepEqual(archive.entries.map(e => e.name), ["a.txt", "b.bin", "c.txt"]);
    assert.equal(archive.chained, true);
    assert.ok(archive.entries[0].stored < text.length, "the fixture compresses repeated text");
    assert.deepEqual(entry(b, "a.txt"), text);
    assert.deepEqual(entry(b, "b.bin"), bytes);
    assert.deepEqual(archives.buildArchive(b), b, "a rebuild without changes is identical");

    const replacement = Buffer.alloc(archives.CHUNK + 5, 0x41);
    const rebuilt = archives.buildArchive(b, new Map([["b.bin", replacement]])), after = archives.parseArchive(rebuilt);
    assert.deepEqual(entry(rebuilt, "b.bin"), replacement);
    assert.equal(after.entries[1].stored, replacement.length + 16, "two stored GCE0 blocks");
    for (const i of [0, 2]) {
        const was = archive.entries[i], now = after.entries[i];
        assert.deepEqual(rebuilt.subarray(now.offset, now.offset + now.stored), b.subarray(was.offset, was.offset + was.stored));
        assert.deepEqual(now.record, was.record);
    }
    assert.throws(() => archives.buildArchive(b, new Map([["missing", Buffer.from("x")]])), /Unknown GCEX entry/);
});

test("GCEX: raw archives, checksums and damaged blocks", () => {
    const raw = gcex([["s_heart.bmp", Buffer.from("BM pixels")]], {chained: false});
    assert.equal(archives.parseArchive(raw).chained, false);
    assert.deepEqual(entry(raw, "s_heart.bmp"), Buffer.from("BM pixels"));
    assert.throws(() => archives.buildArchive(raw, new Map([["s_heart.bmp", Buffer.from("x")]])), /raw entries/);

    const b = gcex([["a.txt", Buffer.from("hello hello hello hello")]]);
    const badIndex = Buffer.from(b); badIndex[badIndex.length - 1] ^= 1;
    assert.throws(() => archives.parseArchive(badIndex), /checksum/);
    assert.throws(() => archives.parseArchive(Buffer.from("not an archive at all, really not one at all")), /Not a GCEX/);

    const block = gce1(Buffer.from("hello hello hello hello"));
    const literals = block.readUInt32LE(12), control = block.subarray(0x18 + literals);
    assert.throws(() => archives.decodeLzp(block.subarray(0x18, 0x18 + literals), control.subarray(0, 1), 23), /ended early/);
    assert.throws(() => archives.decodeLzp(Buffer.alloc(0), Buffer.from([0x40]), 4), /ended early/);
});

test("PC game folder: scan, line feeds, paging, inject with backup, repeat, and plain export", async () => {
    const game = await gameFolder(), original = await fs.readFile(path.join(game, "script"));
    try {
        assert.equal(await parser.detectpm4Pc(game), true);
        assert.equal(await parser.detectpm4Pc(path.join(game, "PM4.exe")), true);
        const scanned = await parser.pm4Ps2Project.scan(path.join(game, "PM4.exe"));
        assert.equal(scanned.platform, "pc");
        assert.equal(scanned.gameFolder, game);
        assert.deepEqual(scanned.files, parser.PC_FILES);
        assert.equal(scanned.manifest.archive, "script");
        assert.equal(scanned.manifest.archiveSize, original.length);
        const room = await parser.parseFile(path.join(scanned.sourceDir, "room.g2"));
        assert.ok(byText(room, "一行目\n二行目\n三行目") >= 0, "a stored line feed is a line break");
        assert.ok(byText(room, "名前は{{daughter}}です。") >= 0);
        const items = await parser.parseFile(path.join(scanned.sourceDir, "item_msg.txt"));
        assert.ok(byText(items, "強い剣\n重い") >= 0);
        await fs.rm(scanned.sourceDir, {recursive: true});

        const translations = {
            "room.g2": {translationPair: {"一行目\n二行目\n三行目": "One\nTwo\nThree\nFour", "名前は{{daughter}}です。": "Name: {{daughter}}."}},
            "item_msg.txt": {translationPair: {"強い剣\n重い": "A strong sword.\nHeavy."}}
        };
        const options = {manifest: scanned.manifest, translations};
        const first = await parser.exportPcGame(game, game, options);
        assert.equal(first.path, path.join(game, "script"));
        assert.equal(first.backup, path.join(game, "script.orig_backup"));
        assert.deepEqual(first.patchedFiles.sort(), ["item_msg.txt", "room.g2"]);
        assert.equal(first.pagedMessages, 1);
        assert.deepEqual(await fs.readFile(first.backup), original);

        const installed = await fs.readFile(path.join(game, "script"));
        const rebuiltRoom = entry(installed, "room.g2"), tokens = parser.readG2(rebuiltRoom).strings;
        assert.ok(tokens.some(t => t.rawText === "One\nTwo\nThree"), "line breaks are written as line feeds");
        assert.ok(tokens.some(t => t.rawText === "Four"), "the fourth line continues on a new page");
        assert.ok(!tokens.some(t => t.rawText.includes("\\n")));
        assert.equal(entry(installed, "item_msg.txt").toString("latin1"), "\r\nA strong sword.\\nHeavy.\r\n\x8b\xad\x82\xa2\x8f\x82\r\n",
            "item lists keep `\\n` text");
        for (const name of ["album.txt", "prime4.g2", "prime4.g2m", "item_nam.txt"]) assert.deepEqual(entry(installed, name), entry(original, name));

        // The next Inject reads the original from the backup and leaves it alone.
        const second = await parser.exportPcGame(game, game, options);
        assert.equal(second.backup, undefined);
        assert.deepEqual(await fs.readFile(path.join(game, "script")), installed);
        assert.deepEqual(await fs.readFile(path.join(game, "script.orig_backup")), original);
        assert.deepEqual((await fs.readdir(game)).sort(), ["PM4.exe", "script", "script.orig_backup"]);

        // Updating the project from source finds the original in the backup.
        assert.equal((await parser.inspectPcGame(game)).manifest.archiveSha256, scanned.manifest.archiveSha256);

        const exportDir = path.join(game, "export");
        const exported = await parser.exportPcGame(game, exportDir, options);
        assert.deepEqual(await fs.readdir(exportDir), ["script"]);
        assert.deepEqual(await fs.readFile(exported.path), installed);
        await parser.exportPcGame(game, exportDir, {manifest: scanned.manifest});
        assert.deepEqual(await fs.readFile(exported.path), original, "a plain export folder is simply overwritten");
    } finally { await fs.rm(game, {recursive: true, force: true}); }
});

test("PC export never replaces an unknown script without a backup and keeps invalid rows out", async () => {
    const game = await gameFolder(), other = await gameFolder(Buffer.from("someone else's archive"));
    try {
        const {manifest} = await parser.inspectPcGame(game);
        await assert.rejects(parser.exportPcGame(game, other, {manifest}), /not the Japanese original and has no script\.orig_backup/);
        assert.deepEqual(await fs.readFile(path.join(other, "script")), Buffer.from("someone else's archive"));

        const before = await fs.readFile(path.join(game, "script"));
        await assert.rejects(parser.exportPcGame(game, game, {manifest, translations: {"room.g2": {translationPair: {"名前は{{daughter}}です。": "Name."}}}}),
            /runtime variable placeholders/);
        assert.deepEqual(await fs.readFile(path.join(game, "script")), before);
        assert.deepEqual((await fs.readdir(game)).sort(), ["PM4.exe", "script"], "nothing is written when a row is invalid");

        await fs.writeFile(path.join(game, "script"), Buffer.from("changed"));
        await assert.rejects(parser.exportPcGame(game, game, {manifest}), /original Japanese 'script' archive of this project is not in/);
    } finally {
        await fs.rm(game, {recursive: true, force: true}); await fs.rm(other, {recursive: true, force: true});
    }
});

test("PC detection rejects other folders and an already translated archive", async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), "pm4-pc-empty-"));
    const game = await gameFolder();
    try {
        assert.equal(await parser.detectpm4Pc(empty), false);
        assert.equal(await parser.detectpm4Pc(path.join(empty, "missing")), false);
        const {manifest} = await parser.inspectPcGame(game);
        const pair = {"一行目\n二行目\n三行目": "One", "語り一\n語り二": "Two", "\n語り三": "\nThree", "名前は{{daughter}}です。": "Name {{daughter}}."};
        await parser.exportPcGame(game, path.join(empty, "out"), {manifest, translations: {"room.g2": {translationPair: pair}}});
        assert.equal(await parser.detectpm4Pc(path.join(empty, "out")), false);
        await assert.rejects(parser.inspectPcGame(path.join(empty, "out")), /is not Japanese/);
    } finally {
        await fs.rm(empty, {recursive: true, force: true}); await fs.rm(game, {recursive: true, force: true});
    }
});
