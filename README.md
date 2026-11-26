# Princess Maker 4 — Japanese PS2 parser

Open a Japanese **SLPM_659.36** PS2 ISO in Translator++, translate its text, and
export a separate disc image. The original ISO is read-only.

1. Choose **New Project → Princess Maker 4 (PS2)** and select the `.iso`.
2. Edit `ROOM.G2` (story and choices), `PRIME4.G2` (startup/system messages),
   `ITEM_NAM.TXT`, and `ITEM_MSG.TXT`. The original language is Japanese; the
   initial target is English and can be changed in Translator++.
3. Save the `.trans` project normally. Keep the original ISO at its selected
   location: it is required for export and project updates.
4. Use **Export → Folder** to create `<original>.translated.iso` in the output
   folder. ZIP export wraps that ISO in a ZIP. **Inject** also creates a separate
   ISO in the destination folder; it does not overwrite the source disc.
   Existing exports get numbered filenames.

Only checked/selected resources and the normal Translator++ row/tag filters are
translated during text export. Image export follows the selected image files and
their visible layers. Every other disc byte is copied from the original.
The normal rightmost nonempty translation and context overrides are supported.

New projects include an **Actor Reference** with editable name translations,
pronouns, and short speech notes. AI translation can use the reference to
identify speakers, including **Daughter**. Find the game's tone and storage
guidance under **Translator → Prompts**.

## Text constraints

- Select a row to see its **maximum CP932 byte budget** in the grid toolbar.
  ASCII normally costs one byte, Japanese normally two. An overlong translation
  is refused with its resource and context address. Text is never truncated.
  Export lists all invalid rows together with their grid row numbers, byte counts,
  and required reductions, before creating the ISO.
- Keep the source line count, including blank lines. The grid shows real line
  breaks; the writer restores the game's literal `\n` escapes.
- Keep `%d`, `%2d`, `%3d`, and other placeholders in their original order.
- Shorter translations are space-padded to preserve every bytecode offset and
  ISO extent. Item lines also retain their original byte budgets in this version.
- Characters outside CP932, including emoji and most non-Japanese Asian scripts,
  are refused. CP932 representability does not establish that a glyph exists in
  the game's font.

## Game artwork and PNG editing

By default, new projects include **80 editable interface sheets**. Turn on
**Include all game artwork (including CGs)** to load all **1,263 sprite sheets**
from the Japanese PS2 disc, including event and ending CGs, backgrounds,
character art, portraits, and thumbnails. The OCR option applies to interface
sheets. Game movies and fonts are outside this workflow.

In an existing project, choose **Tools → Princess Maker 4 (PS2) → Add all game
artwork (without OCR)**. This adds missing sheets to the **Images** pane,
including sheets without text, and keeps existing image edits and OCR boxes.
**Add game images to this project** imports missing interface sheets with OCR.
Use Image edit mode to draw or translate text boxes, or choose **Edit current
image in Krita** to paint the whole sheet. Untranslated boxes preserve the
source pixels.

For another image editor:

1. Choose **Tools → Princess Maker 4 (PS2) → Export PNGs for editing** and an
   empty folder. This exports the current compositions, with unchanged sheets
   copied losslessly.
2. Edit the PNGs, preserving their **filenames, dimensions and transparency**.
   Save as **non-interlaced 8-bit RGB/RGBA PNG**. Only include the sheets you
   changed in the re-import folder.
3. Choose **Import edited PNGs** and that folder. The imported full sheets are
   stored as replacement layers; the original layer is hidden to avoid doubled
   alpha. The original PNG remains intact. Existing painted layers get backups.
4. Save the `.trans` project. **Inject**, folder export and ZIP export repack the
   edited sheets into their original SPD/TIM2 resources **inside the ISO**.
   Resize, unsupported PNG or sprite format errors stop export rather than
   relocating resources or writing loose PNGs beside the disc image.

Project update preserves image text, drawn boxes, styles and staged paint layers
when the original sheet is unchanged. Save the previous project before updating
if replacing the source disc with a different revision.

Full PNG sheets—not independent cropped labels—are the editable unit, so sprite
coordinates keep their original meaning. Schedule sheets contain every animation
frame; edit repeated lettering in all frames.

## English name-entry keyboard

In **Inject**, enable the **English name-entry keyboard** flipswitch to replace
the two kana pages with **ABC / abc**, digits and punctuation. It is off by
default. The patch changes both the pictures and the native input tables in the
exported ISO, so the keys enter the characters shown on screen.

**Allow 12 half-width characters per name field** enables the English keyboard
and supports up to 12 ASCII characters in both the surname and given name. The
standard English keyboard supports six full-width characters per field. Use the
on-screen controller keyboard to enter names.

The switch applies to the whole output disc even when only some project files
are selected. It replaces lettering in the key and bottom-button areas of
`ENTRY2A.SPD` and `ENTRY2B.SPD`, including edits in those areas. The 12-character
option also replaces the two name prompts in `ENTRY5.SPD`. Other image edits
are retained. Turn it off to keep your own name-entry artwork and original kana
input. Each Inject starts with the switch off, and the original ISO is unchanged.

English name entry and subsequent display in the status panel and dialogue
speaker plate have been confirmed by the user in PCSX2.

## Scope and limits

Default import has **10,657 distinct editable rows** across four resources on
the inspected retail disc. Repeated text shares a row, with all occurrences and
their byte budgets retained. Verified speaker names appear in the expanded row
headers. The parser tracks explicit name-plate commands across statements and
voice calls, so tutorial dialogue such as the Cube status explanation is labelled
`キューブ`. Repeated dialogue retains speaker information for each occurrence.

Speaker coverage is partial. Known runtime variables display **Daughter (custom
name)** and **Father (custom name)**, since the actual names depend on the player's
save. Unknown variables, conflicting branch paths, and names after unverified
native/script calls remain blank. `speakerKind` in
row parameters distinguishes literal, runtime, cleared, and unknown names. This
is conservative metadata extraction, not a complete execution of the game's VM.

Resource paths and non-Japanese short engine strings are excluded. Bytecode symbols and album manifests are not
translation targets.

The optional **Include TEST.G2 and DEVTEST.G2** setting imports development
scripts too. It is off by default to avoid translating near-duplicate content.

This supports script text, picture-based lettering, and the optional name-entry
keyboard table patch. Font replacement is not supported. The supplied `pm4-english-patch` research is
for the PC edition: its GCEX archives, patch offsets, UI images, and executable
patches cannot be applied directly to this PS2 disc. No PC translation data or
game assets are bundled here.

Exports are structurally verified and preserve original disc layout. The user
has confirmed translated dialogue playback and English name entry in PCSX2.
Broader testing of translated scenes, choices and edited artwork remains useful
for checking layout and rendering throughout the game.

## Development

`pm4Ps2.module.js` provides portable extraction, strict VM validation, fixed-size
rewriting, ISO discovery, staging, and streamed ISO export. `pm4Ps2.js` supplies
the project wizard, detector, AddonUtils hooks, and folder/ZIP/inject integration.
`pm4Ps2.images.js` decodes/rebuilds SPD/TIM2 sheets and lossless PNGs;
`pm4Ps2.keyboard.js` validates and replaces native keyboard tables and key labels;
`pm4Ps2.image-ui.js` integrates the Images pane, OCR, paint-layer re-import and
whole-disc image injection. Saved creation settings and the original ISO checksum
live in `project.options.init`; text resources and decoded image sheets are staged.

Run from the repository root:

```powershell
& '3rdParty/node-v24.17.0-win-x64/node.exe' --test www/addons/pm4Ps2/test/pm4Ps2.module.test.js www/addons/pm4Ps2/test/pm4Ps2.images.test.js www/addons/pm4Ps2/test/pm4Ps2.keyboard.test.js
```

Tests generate original synthetic G2/ISO fixtures; no retail game content is
included. The optional worker is a source-development helper and is excluded
from compiled packages. The app integration uses the module directly.

See [format notes](plan/README.md) for measured PS2 details.
