"use strict";
// Portable PS2 parser: no app globals, external executables, or PC patch data.
const fs = require("fs"), path = require("path"), os = require("os"), crypto = require("crypto");
const {Transform} = require("stream");
const {pipeline} = require("stream/promises");
const iconv = require("iconv-lite");
const imageCodec = require("./pm4Ps2.images.js");
const keyboard = require("./pm4Ps2.keyboard.js");
const SECTOR = 2048;
const MAIN_FILES = ["ROOM.G2", "PRIME4.G2", "ITEM_NAM.TXT", "ITEM_MSG.TXT"];
const TEST_FILES = ["TEST.G2", "DEVTEST.G2"];
const hash = data => crypto.createHash("sha256").update(data).digest("hex");
const normalize = text => text.replace(/\r\n?/g, "\n");
const display = text => normalize(text).replace(/\\n/g, "\n");
const japanese = text => /[\u3000-\u30ff\u3400-\u9fff\uff61-\uff9f]/.test(text);
function check(condition, message) { if (!condition) throw new Error(message); }
function range(b, p, n) { check(Number.isSafeInteger(p) && Number.isSafeInteger(n) && p >= 0 && n >= 0 && p + n <= b.length, "Truncated or invalid PM4 data."); }
function u32(b, p) { range(b, p, 4); return b.readUInt32LE(p); }
function transformString(b, encode = false) { return Buffer.from(Array.from(b, (v, i) => (v + (encode ? 1 : -1) * (i + b.length)) & 255)); }
function strictEncode(text) {
    const bytes = iconv.encode(text, "cp932");
    check(iconv.decode(bytes, "cp932") === text, "Text contains characters that cannot be represented in CP932 (Shift-JIS).");
    return bytes;
}
function strictDecode(bytes) {
    const text = iconv.decode(bytes, "cp932");
    check(!text.includes("\ufffd"), "Invalid CP932 text in PM4 resource."); return text;
}
// Operand widths measured against all four SLPM_659.36 scripts. Parsing must
// consume the complete file, every sequential statement, and every jump target.
const WORD_OPS = new Set([3, 5, 7, 8, 9, 10, 0x13, 0x14, 0x20, 0x21, 0x40, 0x41, 0x42, 0x44, 0x45, 0x51, 0x53]);
const SINGLE_OPS = new Set([4, 6, 0x0d, 0x0e, 0x11, 0x16, 0x1b, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x89, 0x8b, 0x8c, 0x8d, 0x8e, 0x91, 0x92, 0x93, 0x94, 0x95, 0x96, 0x9a, 0x9c, 0x9e, 0x9f, 0xa3, 0xa4, 0xf0]);
const CODE_PREFIX = Buffer.from("1b20010000002002000000", "hex");
// Conservative name-state analysis. 2100(1, literal) sets the name plate;
// 2100(0) clears it; variable 2/3 are the player-named daughter/father. Their
// roles are known, but the actual save-dependent names are not. Only
// the observed voice command 1620 is allowed to preserve names across native
// calls. Script calls, other native calls, and disagreeing branch paths lose
// the known name rather than attributing dialogue to a nearby character.
function assignSpeakers(events, entries) {
    const UNKNOWN = null, runtimeStates = new Map(), incoming = new Array(events.length);
    function runtimeState(variableId) {
        if (!runtimeStates.has(variableId)) runtimeStates.set(variableId, {variableId});
        return runtimeStates.get(variableId);
    }
    const queue = [];
    function locate(offset) {
        let lo = 0, hi = events.length;
        while (lo < hi) { const mid = (lo + hi) >>> 1; if (events[mid].offset < offset) lo = mid + 1; else hi = mid; }
        return lo;
    }
    function merge(index, value) {
        if (index >= events.length) return;
        const before = incoming[index];
        const after = before === undefined ? value : before === value ? before : UNKNOWN;
        if (before !== after) { incoming[index] = after; queue.push(index); }
    }
    for (const offset of entries) merge(locate(offset), UNKNOWN);
    for (const event of events) if (event.type === "call") merge(locate(event.target), UNKNOWN);
    for (let head = 0; head < queue.length; head++) {
        const index = queue[head], event = events[index]; let state = incoming[index];
        if (event.type === "name") state = event.kind === "literal" ? event.name : event.kind === "none" ? "" : runtimeState(event.variableId);
        else if (event.type === "call" || event.type === "unknown") state = UNKNOWN;
        if (event.type === "return") continue;
        // Both edges even for jump 07: over-approximating possible paths can
        // only remove a known name at joins, never invent one.
        if (event.type === "branch") merge(locate(event.target), state);
        merge(index + 1, state);
    }
    for (let index = 0; index < events.length; index++) {
        const event = events[index]; if (event.type !== "dialogue") continue;
        const state = incoming[index];
        const runtime = state && typeof state === "object";
        const roles = {2: "Daughter (custom name)", 3: "Father (custom name)"};
        event.token.rowInfoText = typeof state === "string" ? state : runtime ? roles[state.variableId] || "" : "";
        event.token.speakerKind = typeof state === "string" ? (state ? "literal" : "none") : runtime ? "runtime" : "unknown";
        if (runtime && Number.isInteger(state.variableId)) event.token.speakerVariable = state.variableId;
    }
}
function readG2(b) {
    check(b.subarray(0, 9).equals(Buffer.from("G2CD0460\x1b", "binary")), "Unsupported G2 script (expected G2CD0460).");
    const statementCount = u32(b, 9), symbolCount = u32(b, 13);
    check(symbolCount < 100000 && statementCount < 1000000, "Invalid G2 header counts.");
    let p = 21;
    const symbols = [];
    for (let i = 0; i < symbolCount; i++) {
        const n = u32(b, p); p += 4; range(b, p, n + 4);
        strictDecode(transformString(b.subarray(p, p + n)));
        symbols.push(u32(b, p + n)); p += n + 4;
    }
    const tableStart = p;
    while (p + CODE_PREFIX.length <= b.length && !b.subarray(p, p + CODE_PREFIX.length).equals(CODE_PREFIX)) {
        check(u32(b, p) < b.length, "Invalid G2 jump table."); p += 4;
    }
    check(p + CODE_PREFIX.length <= b.length, "G2 bytecode entry marker is missing.");
    const codeStart = p, boundaries = new Set(), strings = [], events = [];
    let statement = 0, arguments_ = [];
    while (p < b.length) {
        const offset = p, opcode = b[p++]; boundaries.add(offset - codeStart - 1);
        if (opcode === 1 || opcode === 2) {
            const byteLength = u32(b, p); p += 4; range(b, p, byteLength);
            const rawText = strictDecode(transformString(b.subarray(p, p + byteLength))), text = display(rawText);
            if (text.trim() && (opcode === 1 || japanese(text))) {
                check(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text), "Unexpected control character in G2 text.");
                const token = {offset: p, byteLength, text, rawText, context: ["g2", offset.toString(16)], statement, opcode, rowInfoText: ""};
                strings.push(token);
                if (opcode === 1) events.push({offset, type: "dialogue", token});
            }
            arguments_.push({opcode, value: text});
            p += byteLength;
        } else if (WORD_OPS.has(opcode)) {
            const value = u32(b, p); p += 4;
            if (opcode === 0x20 || opcode === 0x21) {
                check(value === statement + 1, "Nonsequential G2 statement index at 0x" + offset.toString(16));
                statement = value; arguments_ = [];
            } else if (opcode === 5) {
                if (value === 0x2100) {
                    const mode = arguments_[0], name = arguments_[1];
                    const literal = arguments_.length === 2 && mode?.opcode === 3 && mode.value === 1 && name?.opcode === 2 && !/[\n%\\$]/.test(name.value);
                    const cleared = arguments_.length === 1 && mode?.opcode === 3 && mode.value === 0;
                    const variableId = arguments_.length === 2 && mode?.opcode === 3 && mode.value === 1 && name?.opcode === 0x42 ? name.value : undefined;
                    events.push({offset, type: "name", kind: literal ? "literal" : cleared ? "none" : "runtime", name: literal ? name.value : "", variableId});
                } else if (value !== 0x1620) events.push({offset, type: "unknown"});
                arguments_ = [];
            } else {
                if ([7, 8, 9].includes(opcode)) events.push({offset, type: "branch", target: codeStart + 1 + value});
                else if (opcode === 0x0a || opcode === 0x13) events.push({offset, type: "call", target: codeStart + 1 + value});
                arguments_.push({opcode, value});
            }
        } else {
            check(SINGLE_OPS.has(opcode), "Unknown G2 opcode 0x" + opcode.toString(16) + " at 0x" + offset.toString(16));
            if (opcode === 6) arguments_ = [];
            else arguments_.push({opcode});
            if (opcode === 0x0e) events.push({offset, type: "return"});
        }
        if (arguments_.length > 16) arguments_ = [{opcode: -1}];
    }
    check(statement + 1 === statementCount, "G2 statement count mismatch.");
    for (let q = tableStart; q < codeStart; q += 4) check(boundaries.has(u32(b, q)), "G2 jump target is not an instruction boundary.");
    // PRIME4.G2 ships a stale sell_item symbol at offset 72, inside an operand.
    // Symbol bytes remain untouched; jump targets, statements, and the VM itself
    // are validated strictly. Do not reject this original retail resource.
    for (const offset of symbols) check(offset >= 0 && offset < b.length - codeStart, "G2 symbol target is outside the bytecode.");
    assignSpeakers(events, [codeStart + 1, ...symbols.map(offset => codeStart + 1 + offset)]);
    return {strings, codeStart, statementCount, symbolCount, unresolvedSymbols: symbols.filter(offset => !boundaries.has(offset))};
}
function readItems(b) {
    const text = strictDecode(b);
    check(!text.replace(/\r\n/g, "").includes("\n"), "Expected CRLF item text.");
    const strings = []; let offset = 0;
    text.split("\r\n").forEach((rawText, line) => {
        const byteLength = strictEncode(rawText).length;
        if (line > 0 && rawText.trim()) strings.push({offset, byteLength, text: display(rawText), rawText, context: ["item", String(line)], line});
        offset += byteLength + 2;
    });
    check(strings.length > 0, "No item text found."); return {strings};
}
function readResource(b, name) { return /\.G2$/i.test(name) ? readG2(b) : readItems(b); }
function dataset(b, name) {
    const result = {data: [], context: [], parameters: [], tags: [], indexIds: Object.create(null)};
    for (const token of readResource(b, name).strings) {
        let row = result.indexIds[token.text];
        if (row === undefined) {
            row = result.data.length; result.indexIds[token.text] = row;
            result.data.push([token.text, ""]); result.context.push([]); result.parameters.push([]); result.tags.push([]);
        }
        result.context[row].push(token.context.join("/"));
        result.parameters[row].push({byteLength: token.byteLength, offset: token.offset, statement: token.statement, rowInfoText: token.rowInfoText || "",
            ...(token.opcode === 1 ? {speakerKind: token.speakerKind, speakerSource: "pm4-name-command"} : {}),
            ...(Number.isInteger(token.speakerVariable) ? {speakerVariable: token.speakerVariable} : {}),
            rowInfoNote: "CP932 budget: " + token.byteLength + " bytes; keep line count and % codes."});
    }
    check(result.data.length, "No translatable text in " + name); return result;
}
function lookup(token, options) {
    const pairs = options.translationPair || {}, keys = [token.context.join("/") + "\n" + token.text];
    const group = options.translationInfo?.groupLevel || 0;
    if (group > 0) keys.push(token.context.slice(0, group).join("/") + "\n" + token.text);
    keys.push(token.text);
    for (const key of keys) if (Object.prototype.hasOwnProperty.call(pairs, key) && typeof pairs[key] === "string" && pairs[key] !== "") return pairs[key];
    return token.text;
}
function codes(text) { return text.match(/%[-+0 #]*\d*(?:\.\d+)?[diuoxXfFeEgGcs%]|\\[^n]/g) || []; }
function resourceChanges(b, name, options = {}) {
    const patches = [], issues = [], rows = new Map(), uniqueIssues = new Map();
    for (const token of readResource(b, name).strings) {
        if (!rows.has(token.text)) rows.set(token.text, rows.size);
        const row = rows.get(token.text);
        const target = display(lookup(token, options)); if (target === token.text) continue;
        const messages = [];
        if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(target)) messages.push("invalid control character");
        if (target.split("\n").length !== token.text.split("\n").length) messages.push("preserve the source line count");
        if (JSON.stringify(codes(target)) !== JSON.stringify(codes(token.text))) messages.push("preserve % placeholders and control codes in order");
        let bytes;
        try { bytes = strictEncode(target.replace(/\n/g, "\\n")); } catch (e) { messages.push(e.message); }
        if (bytes && bytes.length > token.byteLength) messages.push("translation uses " + bytes.length + " CP932 bytes; maximum is " + token.byteLength + " (shorten by " + (bytes.length - token.byteLength) + " bytes)");
        if (messages.length) {
            const message = messages.join("; "), key = JSON.stringify([row, target, message]);
            const existing = uniqueIssues.get(key);
            if (existing) existing.contexts.push(token.context.join("/"));
            else {
                const issue = {file: name, row, source: token.text, target, byteLength: bytes?.length, budget: token.byteLength,
                    context: token.context.join("/"), contexts: [token.context.join("/")], message};
                issues.push(issue); uniqueIssues.set(key, issue);
            }
            continue;
        }
        const padded = Buffer.alloc(token.byteLength, 0x20); bytes.copy(padded);
        patches.push({offset: token.offset, bytes: /\.G2$/i.test(name) ? transformString(padded, true) : padded});
    }
    return {patches, issues};
}
function translationError(issues) {
    const lines = issues.slice(0, 50).map(i => i.file + ": row " + (i.row + 1) + " (" + i.context + "): " + i.message + ".");
    if (issues.length > 50) lines.push("... and " + (issues.length - 50) + " more issues.");
    const error = new Error("Cannot export: " + issues.length + " invalid translation" + (issues.length === 1 ? "" : "s") + ". Shorten over-budget text and preserve source line counts and placeholders.\n" + lines.join("\n"));
    error.name = "PM4TranslationError"; error.issues = issues; return error;
}
function validateResource(b, name, options = {}) { return resourceChanges(b, name, options).issues; }
function rebuildResource(b, name, options = {}) {
    const {patches, issues} = resourceChanges(b, name, options);
    if (issues.length) throw translationError(issues);
    const output = Buffer.from(b);
    for (const patch of patches) patch.bytes.copy(output, patch.offset);
    readResource(output, name); return output;
}
async function parseFile(sourcePath) { return dataset(await fs.promises.readFile(sourcePath), path.basename(sourcePath)); }
async function writeFile(sourcePath, destinationPath, options = {}) {
    check(path.resolve(sourcePath).toLowerCase() !== path.resolve(destinationPath).toLowerCase(), "Original resources are read-only.");
    const output = rebuildResource(await fs.promises.readFile(sourcePath), path.basename(sourcePath), options);
    await fs.promises.mkdir(path.dirname(destinationPath), {recursive: true});
    await fs.promises.writeFile(destinationPath, output, {flag: "wx"}); return destinationPath;
}
async function readAt(handle, offset, size, totalSize) {
    check(Number.isSafeInteger(offset) && Number.isSafeInteger(size) && offset >= 0 && size >= 0 && size <= 32 * 1024 * 1024 && offset + size <= totalSize, "Invalid ISO extent.");
    const b = Buffer.alloc(size); let done = 0;
    while (done < size) { const {bytesRead} = await handle.read(b, done, size - done, offset + done); check(bytesRead > 0, "Unexpected end of ISO."); done += bytesRead; }
    return b;
}
async function isoFiles(handle, base, imageSize, regionSize = imageSize - base) {
    const pvd = await readAt(handle, base + 16 * SECTOR, SECTOR, imageSize);
    check(pvd.subarray(0, 7).equals(Buffer.from([1, 67, 68, 48, 48, 49, 1])), "Expected an unencrypted ISO9660 filesystem.");
    check(pvd.readUInt16LE(128) === SECTOR, "Only 2048-byte ISO sectors are supported.");
    const files = [], visited = new Set();
    async function walk(lba, size, prefix = "", depth = 0) {
        check(depth < 16 && !visited.has(lba), "Invalid ISO directory tree."); visited.add(lba);
        check(lba * SECTOR + size <= regionSize, "ISO directory is outside its container.");
        const b = await readAt(handle, base + lba * SECTOR, size, imageSize);
        for (let p = 0; p < b.length;) {
            const n = b[p]; if (!n) { p = (Math.floor(p / SECTOR) + 1) * SECTOR; continue; }
            range(b, p, n); check(n >= 34 && b[p + 32] <= n - 33, "Invalid ISO directory record.");
            const r = b.subarray(p, p + n); p += n;
            const id = r.subarray(33, 33 + r[32]); if (id.length === 1 && id[0] < 2) continue;
            check(!(r[25] & 0x80) && r[1] === 0 && r[26] === 0 && r[27] === 0, "Multi-extent/interleaved ISO resources are unsupported.");
            const entryLba = u32(r, 2), entrySize = u32(r, 10);
            check(entryLba === r.readUInt32BE(6) && entrySize === r.readUInt32BE(14), "ISO endian fields disagree.");
            check(entryLba * SECTOR + entrySize <= regionSize, "ISO resource is outside its container.");
            const name = id.toString("ascii").replace(/;\d+$/, "");
            check(!/[\\/]/.test(name) && name !== "..", "Invalid ISO filename.");
            if (r[25] & 2) await walk(entryLba, entrySize, prefix + name + "/", depth + 1);
            else files.push({name: prefix + name, offset: base + entryLba * SECTOR, size: entrySize});
        }
    }
    await walk(u32(pvd, 158), u32(pvd, 166)); return files;
}
async function inspectIso(isoPath, options = {}) {
    const handle = await fs.promises.open(isoPath, "r");
    try {
        const stat = await handle.stat(), outer = await isoFiles(handle, 0, stat.size);
        const system = outer.find(f => f.name === "SYSTEM.CNF"), data = outer.find(f => f.name === "DATA.BIN");
        check(system && data, "Not a supported Princess Maker 4 PS2 disc.");
        const config = (await readAt(handle, system.offset, system.size, stat.size)).toString("ascii");
        check(/SLPM_659\.36;1/.test(config), "Only the Japanese PS2 release SLPM_659.36 is supported.");
        check((await readAt(handle, data.offset, 4, stat.size)).toString("ascii") === "CVMH", "DATA.BIN is not a CRI CVM container.");
        const inner = await isoFiles(handle, data.offset + 0x1800, stat.size, data.size - 0x1800), resources = [];
        for (const name of MAIN_FILES.concat(options.includeTestScripts ? TEST_FILES : [])) {
            const record = inner.find(f => f.name === name); check(record, "Missing PS2 resource " + name);
            const b = await readAt(handle, record.offset, record.size, stat.size); readResource(b, name);
            resources.push({...record, sha256: hash(b)});
        }
        const manifest = {format: 1, serial: "SLPM_659.36", isoSize: stat.size, resources};
        if (options.includeImages || options.includeAllImages) {
            if (options.includeAllImages) manifest.includeAllImages = true;
            manifest.imageResources = [];
            const isSheet = options.includeAllImages ? name => /^[A-Z0-9_]+\.SPD$/.test(name) : imageCodec.isImageCandidate;
            for (const record of inner.filter(f => isSheet(f.name))) {
                const b = await readAt(handle, record.offset, record.size, stat.size), layout = imageCodec.parseSpd(b);
                manifest.imageResources.push({...record, sha256: hash(b), width: layout.width, height: layout.height});
            }
        }
        if (options.includeKeyboard) {
            manifest.keyboardResources = [];
            for (const name of keyboard.RESOURCES) {
                const record = (name === "SLPM_659.36" ? outer : inner).find(r => r.name === name);
                check(record, "English keyboard resource is missing: " + name);
                const b = await readAt(handle, record.offset, record.size, stat.size);
                if (name === "SLPM_659.36") keyboard.inspectExecutable(b);
                else { const image = imageCodec.parseSpd(b); check(image.width === 640 && image.height === 448, "Unsupported keyboard sheet dimensions."); }
                manifest.keyboardResources.push({...record, sha256: hash(b)});
            }
        }
        return manifest;
    } finally { await handle.close(); }
}
async function hashFile(file) {
    const digest = crypto.createHash("sha256"); for await (const chunk of fs.createReadStream(file)) digest.update(chunk); return digest.digest("hex");
}
async function extractImages(isoPath, destinationDir, options = {}) {
    const manifest = await inspectIso(isoPath, {...options, includeImages: true});
    if (options.expectedSha256) check(await hashFile(isoPath) === options.expectedSha256, "Source ISO checksum differs from the project.");
    await fs.promises.mkdir(destinationDir, {recursive: true});
    const handle = await fs.promises.open(isoPath, "r"), files = [];
    try {
        for (const record of manifest.imageResources) {
            const b = await readAt(handle, record.offset, record.size, manifest.isoSize);
            check(hash(b) === record.sha256, "Source image changed during extraction: " + record.name);
            const image = imageCodec.decodeSpd(b), png = imageCodec.encodePng(image), name = record.name.replace(/\.SPD$/, ".png");
            const destination = path.join(destinationDir, name);
            // Staging originals are immutable: repeat extraction verifies rather
            // than overwriting a file an artist might have painted accidentally.
            if (fs.existsSync(destination)) check((await fs.promises.readFile(destination)).equals(png), "Extracted PNG already exists with different content: " + destination);
            else await fs.promises.writeFile(destination, png, {flag: "wx"});
            files.push({...record, pngPath: destination, pixelSha256: hash(image.data)});
            options.onProgress?.(files.length, manifest.imageResources.length);
        }
    } finally { await handle.close(); }
    return {manifest, files};
}
class pm4Ps2Project {
    static async scan(entryPoint, options = {}) {
        const isoPath = path.resolve(entryPoint), manifest = await inspectIso(isoPath, options.init || options);
        manifest.isoSha256 = await hashFile(isoPath);
        const sourceDir = options.stagingDir || await fs.promises.mkdtemp(path.join(os.tmpdir(), "tpp-pm4-"));
        await fs.promises.mkdir(sourceDir, {recursive: true});
        const handle = await fs.promises.open(isoPath, "r");
        try {
            for (const r of manifest.resources) {
                const b = await readAt(handle, r.offset, r.size, manifest.isoSize); check(hash(b) === r.sha256, "Source ISO changed during import.");
                await fs.promises.writeFile(path.join(sourceDir, r.name), b, {flag: "wx"});
            }
        } finally { await handle.close(); }
        return {sourceDir, files: manifest.resources.map(f => f.name), manifest, isoPath};
    }
}
async function detectpm4Ps2(entryPoint) { try { await inspectIso(entryPoint); return true; } catch (_) { return false; } }
async function exportIso(sourcePath, destinationPath, options = {}) {
    const expected = options.manifest;
    check(expected?.format === 1 && /^[a-f0-9]{64}$/.test(expected.isoSha256 || ""), "Project source manifest is missing. Recreate this project.");
    check(path.resolve(sourcePath).toLowerCase() !== path.resolve(destinationPath).toLowerCase(), "Cannot overwrite the source ISO.");
    const actual = await inspectIso(sourcePath, {includeTestScripts: expected.resources.some(f => TEST_FILES.includes(f.name)),
        includeImages: Boolean(expected.imageResources), includeAllImages: expected.includeAllImages === true, includeKeyboard: keyboard.isEnabled(options)});
    check(JSON.stringify(actual.resources) === JSON.stringify(expected.resources) && actual.isoSize === expected.isoSize, "The source ISO no longer matches this project.");
    if (expected.imageResources) check(JSON.stringify(actual.imageResources) === JSON.stringify(expected.imageResources), "Source image resources no longer match this project.");
    for (const name of Object.keys(options.images || {})) check(expected.imageResources?.some(r => r.name === name), "Unrecognized PM4 image replacement: " + name);
    const handle = await fs.promises.open(sourcePath, "r"), patches = [], issues = [];
    try {
        for (const record of expected.resources) {
            const selected = options.translations?.[record.name]; if (!selected) continue;
            const original = await readAt(handle, record.offset, record.size, expected.isoSize);
            try {
                const output = rebuildResource(original, record.name, selected);
                if (!output.equals(original)) patches.push({record, output});
            } catch (error) {
                if (error.name !== "PM4TranslationError") throw error;
                issues.push(...error.issues);
            }
        }
        for (const record of expected.imageResources || []) {
            const png = options.images?.[record.name]; if (!png) continue;
            const original = await readAt(handle, record.offset, record.size, expected.isoSize);
            let output;
            try { output = imageCodec.rebuildSpd(original, imageCodec.decodePng(png)); }
            catch (error) { throw new Error(record.name + ": " + error.message); }
            if (!output.equals(original)) patches.push({record, output});
        }
        for (const record of actual.keyboardResources || []) {
            const original = await readAt(handle, record.offset, record.size, expected.isoSize);
            const existing = patches.find(p => p.record.name === record.name);
            const output = record.name === "SLPM_659.36" ? keyboard.patchExecutable(original) :
                keyboard.patchKeyboardSheet(original, existing?.output || original, record.name === "ENTRY2A.SPD" ? 0 : 1);
            if (existing) existing.output = output;
            else if (!output.equals(original)) patches.push({record, output});
        }
    } finally { await handle.close(); }
    if (issues.length) throw translationError(issues);
    // Validate every translation before copying. Stream the copy and digest to
    // keep memory bounded even in 32-bit NW.js. Publish only after verification.
    await fs.promises.mkdir(path.dirname(destinationPath), {recursive: true});
    const temporary = destinationPath + "." + crypto.randomBytes(6).toString("hex") + ".partial"; let ownsTemporary = false;
    try {
        const reserved = await fs.promises.open(temporary, "wx"); ownsTemporary = true; await reserved.close();
        const digest = crypto.createHash("sha256");
        await pipeline(fs.createReadStream(sourcePath), new Transform({transform(chunk, encoding, callback) { digest.update(chunk); callback(null, chunk); }}), fs.createWriteStream(temporary));
        check(digest.digest("hex") === expected.isoSha256, "Source ISO checksum differs from the imported disc.");
        const target = await fs.promises.open(temporary, "r+");
        try {
            for (const {record, output} of patches) {
                let done = 0;
                while (done < output.length) { const {bytesWritten} = await target.write(output, done, output.length - done, record.offset + done); check(bytesWritten > 0, "Unable to write patched ISO."); done += bytesWritten; }
                check((await readAt(target, record.offset, record.size, expected.isoSize)).equals(output), "Patched resource verification failed: " + record.name);
            }
            await target.sync();
        } finally { await target.close(); }
        // Atomic exclusive hard link within the output directory. Never replaces
        // an existing file, including another hard link to the original disc.
        await fs.promises.link(temporary, destinationPath);
        return {path: destinationPath, patchedFiles: patches.map(p => p.record.name), size: expected.isoSize};
    } finally { if (ownsTemporary) await fs.promises.unlink(temporary).catch(() => {}); }
}
module.exports = {pm4Ps2Project, parseFile, writeFile, detectpm4Ps2, inspectIso, extractImages, exportIso, readG2, readItems, dataset, rebuildResource, validateResource, transformString, hashFile};
