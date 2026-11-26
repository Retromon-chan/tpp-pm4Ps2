"use strict";

const assert = require("node:assert/strict");
const {test} = require("node:test");
const {Worker} = require("node:worker_threads");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {g2, iso, speakerG2} = require("./fixtures.cjs");
const parser = require("../pm4Ps2.module.js");

test("business API imports in Node without Translator++ globals", () => {
    for (const name of ["pm4Ps2Project", "parseFile", "writeFile", "detectpm4Ps2"]) {
        assert.equal(typeof parser[name], "function");
    }
});

test("detector rejects a non-game path", async () => {
    assert.equal(await parser.detectpm4Ps2("nonexistent-game-path"), false);
});

test("worker imports the business module and responds to ping", {timeout: 5000}, async () => {
    const worker = new Worker(require.resolve("../pm4Ps2.worker.js"), {workerData: {command: "ping"}});
    try {
        const message = await new Promise((resolve, reject) => {
            worker.once("message", resolve);
            worker.once("error", reject);
            worker.once("exit", code => reject(new Error("Worker exited before responding: " + code)));
        });
        assert.deepEqual(message, {result: "ok", errors: []});
    } finally {
        await worker.terminate();
    }
});

test("structural extraction, speakers, budgets, deduplication, and unchanged round trip", () => {
    const b = g2(), data = parser.dataset(b, "ROOM.G2");
    assert.equal(data.data.length, 3);
    assert.equal(data.data[1][0], "こんにちは\n世界 %d");
    assert.equal(data.parameters[1][0].rowInfoText, "アリス");
    assert.match(data.parameters[1][0].rowInfoNote, /CP932/);
    assert.equal(data.comments, undefined); // bulk comments force one render per row in the host
    assert.equal(data.context[2].length, 2);
    assert.deepEqual(parser.rebuildResource(b, "ROOM.G2"), b);
});
test("speaker commands persist across statements and voice calls; runtime roles and unknown speakers are distinct", () => {
    const b = speakerG2(), strings = parser.readG2(b).strings;
    const get = text => strings.find(t => t.text === text);
    for (const text of ["最初の台詞", "続きの台詞", "同じ名前の合流"]) {
        assert.equal(get(text).rowInfoText, "アリス"); assert.equal(get(text).speakerKind, "literal");
    }
    for (const text of ["不明な台詞", "呼出し後", "分岐の合流"]) {
        assert.equal(get(text).rowInfoText, ""); assert.equal(get(text).speakerKind, "unknown");
    }
    assert.equal(get("名前は実行時").rowInfoText, "Daughter (custom name)"); assert.equal(get("名前は実行時").speakerKind, "runtime");
    assert.equal(get("名前は実行時").speakerVariable, 2);
    assert.equal(get("父の台詞").rowInfoText, "Father (custom name)"); assert.equal(get("父の台詞").speakerVariable, 3);
    assert.equal(get("未知の変数").rowInfoText, ""); assert.equal(get("未知の変数").speakerKind, "runtime");
    assert.equal(get("地の文").rowInfoText, ""); assert.equal(get("地の文").speakerKind, "none");
    assert.equal(get("はい").rowInfoText, "");
    assert.deepEqual(parser.rebuildResource(b, "ROOM.G2"), b);
    const dataset = parser.dataset(b, "ROOM.G2"), row = dataset.indexIds["最初の台詞"];
    assert.equal(dataset.parameters[row][0].speakerSource, "pm4-name-command");
});
test("page advances and nested portrait helpers keep the speaker until a reachable name change", () => {
    const b = speakerG2(), strings = parser.readG2(b).strings;
    for (const text of ["立ち絵の前", "立ち絵の後", "同じ話者の続き"]) {
        const token = strings.find(t => t.text === text);
        assert.equal(token.rowInfoText, "Daughter (custom name)");
        assert.equal(token.speakerKind, "runtime");
        assert.equal(token.speakerVariable, 2);
    }
    const after = strings.find(t => t.text === "名前が消える可能性");
    assert.equal(after.rowInfoText, "");
    assert.equal(after.speakerKind, "unknown");
    assert.deepEqual(parser.rebuildResource(b, "ROOM.G2"), b);
});
test("context overrides, group fallbacks, missing translations, exact byte preservation", () => {
    const b = g2(), tokens = parser.readG2(b).strings, yes = tokens.filter(t => t.text === "はい");
    const pair = {"はい": "Yes", [yes[1].context.join("/") + "\nはい"]: "No"};
    const output = parser.rebuildResource(b, "ROOM.G2", {translationPair: pair});
    assert.equal(output.length, b.length);
    const out = parser.readG2(output).strings;
    // English short labels are intentionally excluded from JP text extraction.
    assert.equal(out.some(t => t.text === "はい"), false);
    const allowed = new Set(yes.flatMap(t => Array.from({length: t.byteLength}, (_, i) => t.offset + i)));
    for (let i = 0; i < b.length; i++) if (!allowed.has(i)) assert.equal(output[i], b[i]);
    const group = parser.rebuildResource(b, "ROOM.G2", {translationPair: {"g2\nはい": "No"}, translationInfo: {groupLevel: 1}});
    assert.notDeepEqual(group, b);
});
test("multiline translation preserves runtime escapes and placeholders", () => {
    const b = g2(), source = "こんにちは\n世界 %d";
    const output = parser.rebuildResource(b, "ROOM.G2", {translationPair: {[source]: "Hello\r\nWorld %d"}});
    const text = parser.readG2(output).strings.find(t => t.opcode === 1).text;
    assert.equal(text.trimEnd(), "Hello\nWorld %d");
    assert.equal(text.split("\n").length, 2);
    assert.throws(() => parser.rebuildResource(b, "ROOM.G2", {translationPair: {[source]: "Hello %d"}}), /line count/);
    assert.throws(() => parser.rebuildResource(b, "ROOM.G2", {translationPair: {[source]: "Hello\nWorld %s"}}), /placeholders/);
    assert.throws(() => parser.rebuildResource(b, "ROOM.G2", {translationPair: {"はい": "Too long"}}), /maximum is 4/);
    assert.throws(() => parser.rebuildResource(b, "ROOM.G2", {translationPair: {"はい": "😀"}}), /CP932/);
    assert.throws(() => parser.rebuildResource(b, "ROOM.G2", {translationPair: {"はい": "a\\nb"}}), /line count/);
});
test("preflight collects every invalid row with readable row numbers and all duplicate contexts", () => {
    const b = g2(), options = {translationPair: {
        "こんにちは\n世界 %d": "An extremely long greeting\nand a long world %d",
        "はい": "Certainly"
    }};
    const issues = parser.validateResource(b, "ROOM.G2", options);
    assert.equal(issues.length, 2);
    assert.deepEqual(issues.map(i => i.row), [1, 2]);
    assert.equal(issues[1].contexts.length, 2);
    assert.equal(issues[1].byteLength, 9);
    assert.equal(issues[1].budget, 4);
    assert.throws(() => parser.rebuildResource(b, "ROOM.G2", options), error => {
        assert.equal(error.name, "PM4TranslationError");
        assert.equal(error.issues.length, 2);
        assert.match(error.message, /ROOM.G2: row 2/);
        assert.match(error.message, /ROOM.G2: row 3/);
        assert.match(error.message, /shorten by 5 bytes/);
        return true;
    });
    assert.deepEqual(parser.validateResource(b, "ROOM.G2", {translationPair: {"はい": "Yes"}}), []);
});
test("corrupt signatures, truncated operands, invalid jumps, and unknown opcodes fail", () => {
    assert.throws(() => parser.readG2(Buffer.from("not a game")), /Unsupported/);
    assert.throws(() => parser.readG2(g2().subarray(0, 50)), /Truncated|missing|count/);
    assert.throws(() => parser.readG2(g2().subarray(0, -1)), /Truncated/);
    const bad = Buffer.concat([g2(), Buffer.from([0xff])]);
    assert.throws(() => parser.readG2(bad), /Unknown G2 opcode/);
    const jump = g2(); jump.writeUInt32LE(2, 33); assert.throws(() => parser.readG2(jump), /jump target/);
    const op = g2(); op[parser.readG2(op).codeStart] = 0; assert.throws(() => parser.readG2(op), /missing|table/);
});
test("item list preserves CRLF, empty header, duplicate rows, and byte budgets", () => {
    const ic = require("iconv-lite"), b = ic.encode("\r\n名前\r\n名前\r\n", "cp932");
    const data = parser.dataset(b, "ITEM_NAM.TXT"); assert.equal(data.data.length, 1); assert.equal(data.context[0].length, 2);
    assert.deepEqual(parser.rebuildResource(b, "ITEM_NAM.TXT"), b);
    const output = parser.rebuildResource(b, "ITEM_NAM.TXT", {translationPair: {"名前": "Name"}});
    assert.equal(output.toString("ascii"), "\r\nName\r\nName\r\n");
    assert.throws(() => parser.rebuildResource(b, "ITEM_NAM.TXT", {translationPair: {"名前": "Long Name"}}), /maximum/);
});
test("complete ISO import, no-op export, patch, wrong source, and exclusive output", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pm4-test-"));
    try {
        const source = path.join(root, "original.iso"), bytes = iso(); await fs.writeFile(source, bytes);
        const scanned = await parser.pm4Ps2Project.scan(source, {stagingDir: path.join(root, "stage")});
        assert.equal(scanned.files.length, 4); assert.equal(await parser.detectpm4Ps2(source), true);
        const options = {manifest: scanned.manifest}, noOp = path.join(root, "no-op.iso");
        await parser.exportIso(source, noOp, options); assert.deepEqual(await fs.readFile(noOp), bytes);
        const translated = path.join(root, "translated.iso");
        const result = await parser.exportIso(source, translated, {...options, translations: {"ROOM.G2": {translationPair: {"はい": "Yes"}}}});
        assert.deepEqual(result.patchedFiles, ["ROOM.G2"]);
        const output = await fs.readFile(translated), rec = scanned.manifest.resources[0];
        assert.deepEqual(output.subarray(0, rec.offset), bytes.subarray(0, rec.offset));
        assert.deepEqual(output.subarray(rec.offset + rec.size), bytes.subarray(rec.offset + rec.size));
        assert.deepEqual(await fs.readFile(source), bytes);
        await assert.rejects(parser.exportIso(source, source, options), /overwrite/);
        await assert.rejects(parser.exportIso(source, translated, options), /EEXIST/);
        const invalid = path.join(root, "invalid.iso");
        await assert.rejects(parser.exportIso(source, invalid, {...options, translations: {
            "ROOM.G2": {translationPair: {"はい": "Over budget"}},
            "PRIME4.G2": {translationPair: {"はい": "Over budget"}}
        }}), error => {
            assert.equal(error.issues.length, 2);
            assert.deepEqual(error.issues.map(i => i.file), ["ROOM.G2", "PRIME4.G2"]);
            return true;
        });
        await assert.rejects(parser.exportIso(source, invalid, {...options, translations: {"ROOM.G2": {translationPair: {"はい": "Over budget"}}}}), /maximum/);
        await assert.rejects(fs.stat(invalid), /ENOENT/);
        bytes[bytes.length - 1] ^= 1; await fs.writeFile(source, bytes);
        await assert.rejects(parser.exportIso(source, invalid, options), /checksum/);
        assert.equal((await fs.readdir(root)).some(f => f.endsWith(".partial")), false);
    } finally { await fs.rm(root, {recursive: true, force: true}); }
});
