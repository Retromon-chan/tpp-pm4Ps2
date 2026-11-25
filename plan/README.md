# Measured format: Princess Maker 4 PS2 / SLPM_659.36

Source inspected: Japanese PS2 ISO, 1,379,336,192 bytes. Research supplied by the
user: `pm4-english-patch/TRANSLATING IT YOURSELF.txt` and readable Python sources.
These describe the PC release. Only the G2 string transform and CP932 text
encoding carry over; PS2 resource discovery and VM parsing were measured anew.

## Disc structure

- Outer ISO9660, 2048-byte sectors; `SYSTEM.CNF` boots `SLPM_659.36;1`.
- `DATA.BIN`: LBA 332, length 1,354,997,760, starts `CVMH`.
- The unencrypted embedded ISO9660 starts at `DATA.BIN + 0x1800`. Its PVD is
  at embedded sector 16. Directory entries provide resource offsets and lengths.
- No complete ISO or CVM is held in memory. Directory reads are bounded and
  resource buffers are small. Export hashes a streamed copy of the original,
  writes only fixed-size resource ranges, rereads those ranges, then publishes
  through an exclusive hard link. Outputs require a filesystem supporting hard
  links (such as NTFS). Existing outputs are never overwritten.

| Resource | Absolute ISO offset | Bytes | Distinct rows | Occurrences |
| --- | ---: | ---: | ---: | ---: |
| ROOM.G2 | 806836224 | 2163247 | 10455 | 14976 |
| PRIME4.G2 | 806756352 | 67978 | 25 | 30 |
| ITEM_NAM.TXT | 806750208 | 979 | 88 | 89 |
| ITEM_MSG.TXT | 806746112 | 3215 | 89 | 89 |

Offsets are observations, never hardcoded patch destinations. Directory parsing
checks both endian copies, range limits, nesting, and unsupported multi-extent
or interleaved files. Only this serial and the unencrypted CVM layout are accepted.

## G2CD0460

- Eight-byte magic, marker `0x1b`, u32 statement limit at +9, u32 symbol count
  at +13, and an opaque u32 at +17 preserved exactly.
- At +21: symbols `[u32 length][scrambled CP932 name][u32 code offset]`.
- Next: u32 jump-table entries until the instruction prefix
  `1b 20 01000000 20 02000000`. The script-entry marker is followed by bytecode.
- Code offsets are relative to the byte immediately after that initial `1b`.
- `01` and `02`: u32 byte length, then scrambled text.
- `stored[i] = (plain[i] + i + byteLength) & 255`.
- Literal `\n` means an in-game line break. Item files use actual CRLF between
  entries, a blank first/header line, and 89 item lines.

Instruction operand widths are recorded in the module's WORD_OPS and SINGLE_OPS.
All four scripts parse from start to exact EOF with sequential `20`/`21`
statement IDs ending at header statement limit minus one; every jump-table target
lands on an instruction boundary. Unknown opcodes, invalid counts, bounds, and
broken jump targets are rejected instead of falling back to scanning bytes.

ROOM.G2 has 26,449 string operands total (10,637 opcode 01 and 15,812 opcode 02).
Only nonempty dialogue and Japanese-bearing short strings are exposed.
PRIME4.G2 ships one stale `sell_item` symbol at code offset 72 inside an operand;
it is preserved. Symbol targets are range checked; jump-table targets are boundary
checked. Requiring every symbol to be an instruction rejects the retail file.

Test/development scripts: TEST.G2 (2,167,728 bytes, 26,790 string operands),
DEVTEST.G2 (2,149,105 bytes, 26,371 string operands). They are optional.

## Rewriting and limitations

Every replacement is CP932 encoded, checked against its byte budget, space padded,
then re-scrambled at the original offset. Length words, statement/jump tables,
symbols, non-text arguments, executable, unedited images, audio, and ISO directories
are unchanged. Item lines use the same fixed-budget policy to preserve their extent
and directory lengths. No repacking or relocation is attempted.

Empty/missing targets preserve original bytes. Text-only, exact-context, and
ParserBase-style group lookup use the same contexts on import and export.
Duplicates retain all locations and parameters, with the minimum applicable
budget shown in the grid toolbar.

## Speaker metadata

The retail script uses native command `0x2100` to control the name plate:
`(1, literal string)` sets a name, `(0)` clears it, and `(1, string variable)`
uses a runtime name. ROOM.G2 has 3,851 literal-name calls, 185 clears, and 2,551
runtime-variable calls (2,547 use variable 2; four use variable 3).
PRIME4.G2 initializes variable 2 with パトリシア and variable 3 with ヘイス via
native `0x1801`; dialogue using variable 2 addresses Papa, while variable 3
describes adopting the daughter and receiving Cube's reports. These are the
daughter/father custom-name slots. Row info displays their roles as
`Daughter (custom name)` and `Father (custom name)`, retaining the numeric slot
in `speakerVariable`. The chosen name itself cannot be recovered from the ISO.
The Cube tutorial sets `キューブ` in statement 1482,
then plays voice `7022` via `0x1620` and displays the status explanation in
statement 1483. This matches the user's running-game screenshot.

The parser records name commands and dialogue as control-flow events. It merges
name state across branches, seeds function entries as unknown, and invalidates
known names at script calls and native calls other than the observed voice call.
Even unconditional jumps are over-approximated with both successor paths to
avoid inventing a name through an omitted path. The metadata therefore has
partial coverage: known player-name slots display role labels; other unresolved
names and ambiguous/unverified paths remain blank. No name is inferred merely
from a nearby Japanese string.

Each dialogue occurrence carries `speakerKind` (`literal`, `runtime`, `none`, or
`unknown`) and `speakerSource: pm4-name-command`. Existing per-occurrence contexts
and row deduplication are unchanged, so a repeated row may have several speakers.
The normal Translator++ row-info display and Actor Reference lookup handle them.

The original full ISO checksum is saved in the project. Export verifies it while
copying, in addition to reparsing/hashing every supported resource. A different
or changed source fails before publication. Validation failures remove only the
private partial output, never the original or an existing finished export.

Synthetic tests cover structured extraction, speakers, duplicates/context/group
lookup, no-op byte identity, translated edits, placeholders, newline preservation,
CP932/size errors, malformed VM/ISO, whole-ISO unrelated-byte preservation,
exclusive destinations, source checksum mismatches, and partial-file cleanup.
Translation preflight aggregates every invalid row across all selected resources,
deduplicating repeated occurrences of the same error while retaining contexts.
Errors carry structured `issues` and display one-based grid row numbers and byte
reductions. `validateResource()` runs the same checks without writing output.
No emulator or hardware playback result is claimed.

## SPD/TIM2 image extraction and re-import

The 80 curated interface candidates match W_*, TMENU*, ENTRY*, SCHD01–23,
HAR01–14, ALBUM1–3, MAP01/MAP02A/MAP02B, EXPLA, and LOGO1–3. This includes
some non-lettered/decorative sheets; it avoids character/face and ordinary scene
art. The full artwork import discovers all 1,263 `.SPD` files in the embedded
ISO root. These include event and ending CGs, backgrounds, character sheets,
portraits and thumbnails. All 1,263 on the inspected disc use the layout below.

- SPD header: `SPD\0`, u32 total size, u32 section count, reserved u32. At +16,
  sections are 16-byte records: u32 ID, size, offset, reserved. Section 1 holds
  TIM2; sections 2/3 hold sprite/frame data and stay byte-identical.
- TIM2 revision 4, alignment 0, count at +6. This game uses the normally reserved
  +8/+10 fields for total sheet width/height. Pictures have standard 48-byte
  headers (layout reference: [OpenKh TIM2 documentation](https://openkh.dev/common/tm2.html)).
- Tiles are at most 256×256, stored **column first, then down each column**.
  Edge tile dimensions exactly match the remaining sheet width/height.
- Supported pictures are ImageType 3, GS PSMCT32, no CLUT, one mipmap level,
  linear RGBA bytes. No swizzle/indexed conversion is attempted or guessed.
- Stored alpha is 0–128. PNG expansion is round(a×255/128), and insertion is
  round(a×128/255), giving an exact inverse for every original stored alpha.
- Only picture payload bytes are rewritten. SPD/TIM2 headers, sprite positions,
  texture registers, frame definitions and every resource/ISO length stay fixed.

The PNG bridge encodes lossless 8-bit RGBA and reads non-interlaced 8-bit RGBA,
RGB, indexed and grayscale PNGs, with all five PNG row filters and CRC checks.
Unsupported depths/interlacing or changed dimensions fail before ISO creation.

New projects can opt into all artwork, with optional OCR on the interface subset.
The Tools menu adds all artwork without OCR. The project keeps the selected
scope for updates, and export verifies the manifest using that scope. Existing
interface-only projects keep that scope until all artwork is added.
Decoded originals are staged at `images/pm4/*.png`, with `type: image` entries
and `pm4Image` resource provenance. Even empty OCR results remain editable.
External PNG imports become versioned Krita/replacement layers; the Original
layer is hidden to avoid double compositing the sprite's translucent edges.
Only translated text boxes paint over sheets. Untranslated OCR boxes are not
masked. These PM4-specific renderer/Krita hooks leave other engines unchanged.

Inject uses Image Translator's `imageTranslatorFiles` map while it temporarily
hides image entries, rebuilds the sheets inside the ISO, and sets
`imageTranslatorHandled` to suppress loose-image output. Folder/ZIP exports use
the same path. Unedited sheets are never rendered or re-encoded during export.
Updates retain boxes, translations, styles and paint/inpaint layer files when
the source sheet hash matches. Unknown or changed sources require review.

Real validation: 80 original sheets passed exact PNG round trips. A status-sheet
VIT test was exported, re-imported, saved/reopened, injected through the normal
application wrapper, and extracted from the resulting ISO. Its native bytes
equal the expected replacement. The other 79 image resources, sprite metadata,
unrelated disc bytes, and original ISO were unchanged. The working project's
temporary VIT test layer was restored afterward. Image gameplay verification is
left to the user; only the earlier text patch has their playback confirmation.

Full artwork validation on the retail disc decoded and rebuilt all 1,263
sheets byte-for-byte. A one-pixel edit to `EV01.SPD` was re-extracted from
the patched ISO and matched the edited PNG. Only three bytes changed across
the whole ISO, all inside that pixel's native payload.

## Optional PS2 English name-entry keyboard

The original outer `SLPM_659.36` ELF is 1,643,332 bytes at LBA 661952,
SHA256 `c673ed7fedf9e1532279c86728a11da8ac7422c1f864e5ddbd6256dcf620c4b3`.
Its hiragana/katakana key tables begin at file offsets `0x18bf00`/`0x18bfc0`.
Each has six top-to-bottom rows, 15 CP932 two-byte keys per row, a two-byte zero
terminator, and a 32-byte row stride. Row-pointer arrays at `0x13bfc0`/`0x13bfd8`
point to these tables. The original full kana table signatures must be unique;
missing/ambiguous signatures, already-patched input, and non-MIPS ELF fail.

The ELF character map contains full-width Latin upper/lowercase letters and
digits. The patch uses those two-byte CP932 characters, retaining the game's
fixed character-slot representation and name limit. ASCII bytes with padding
zeros and PC-edition keyboard offsets are not used. Only the two 192-byte table
regions change; executable instructions and pointers stay intact.

Both 640×448 `ENTRY2A.SPD`/`ENTRY2B.SPD` sheets are patched too. Keys are centered
at `(68+36*column, 168+36*row)`; the four bottom buttons are ABC, abc, Back, OK.
Clean paper is reconstructed locally from an original empty key cell, and the
add-on's transparent overlays contain only newly rendered Latin typography.
No retail artwork or executable content is shipped. The original sprite layout,
dimensions and alpha encoding are retained. Existing image edits outside key
and button masks survive; masks deliberately replace edits inside those areas.

Inject's JSONForm boolean `custom.pm4EnglishKeyboard` uses `flipSwitch` and is
false on each opening. The core also accepts explicit boolean `englishKeyboard`
for portable callers. Enabling it validates/discovers all three resources and
applies the pictures and tables together after normal text/image patches.
Disabling it leaves those resources on the normal export path. Older saved
projects need no migration; keyboard source resources are discovered on demand.

Synthetic tests cover native mapping, padding/terminators, guarded input,
unchanged executable bytes and image pixels outside masks, opt-in serialization,
and whole-ISO off/on round trips. Real Inject UI testing confirms default-off,
boolean submission, a separate output ISO and default-off on reopening. The
retail output's three keyboard resources equal the expected patches; unrelated
disc bytes and the source ISO hash are unchanged. Four CommonJS modules load
after NW.js compilation, including both overlay assets.

The resulting retail disc boots in the user's installed PCSX2 v2.8.2 and reaches
the title screen. This used an isolated data directory and copies of the user's
existing BIOS, without changing their normal emulator setup or saves. On
2026-11-01 the user confirmed successful English character-name entry. Their
gameplay screenshot shows mixed-case English names rendered in the status panel
and dialogue speaker plate. Name entry, confirmation and subsequent in-game
rendering are therefore user-verified. Save/reload persistence, every punctuation
and digit key, Back, and the maximum-length boundary have not been individually
reported as gameplay-tested; these are remaining regression checks, with no known
implementation defect or required keyboard work outstanding.
