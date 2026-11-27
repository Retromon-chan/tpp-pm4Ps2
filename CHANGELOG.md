# Changelog

## 0.7.0 (2026-11-27)

- Enlarged the PS2 shop and inventory item-list text buffer in `SLPM_659.36` when exporting translated item names, fixing cropping on the fifth visible item row.
- Added the Japanese PC release. Choose `PM4.exe` in New Project to translate its story, choices and items with the same limits, pages and `{{daughter}}` placeholders. Inject into the game folder rebuilds the `script` archive and keeps the Japanese original as `script.orig_backup`; Export → Folder writes a `script` to copy in yourself. Artwork, system messages and the English keyboard remain PS2 only.
- Dialogue longer than its 3-line box continues on new pages. The player presses a button to see the rest, with the same speaker, so translations no longer have to fit three lines. The Inject log says how many messages were split. Narration that builds up over several button presses is not split.
- The dialogue limit is now 360 bytes, about three pages. Going over a limit is a warning, and only a page over 960 bytes stops export.
- The AI prompt now says that the game never wraps lines, so translations must break lines at about 34 characters. An unedited earlier prompt is upgraded.
- Updated `README.md` with gameplay video, showcase screenshots, and a separate `USAGE.md` reference guide.

## 0.6.1 (2026-11-26)

- Added editable memory-card, save and load prompts, the return-to-title confirmation, and the date format shared by both birthdays. Use Update Project from Source to add `SLPM_659.36` to an existing project.

## 0.6.0 (2026-11-26)

- Dialogue interrupted by a player name or another directly printed string variable now appears as one row. Keep the inline codes (for example `{{daughter}}` and `{{father}}`) when translating. Update Project from Source combines existing fragment translations. Export and Inject restore the game's runtime variable commands.

- Translations can now be longer than the Japanese. Dialogue and item descriptions take up to 180 bytes (longer letters up to twice the Japanese), choices and names 24 (status messages 1.5× the Japanese), item names 18. The toolbar shows each row's limit next to the Japanese length.
- Line breaks are free: a different line count, moved blank lines and lines wider than about 34 characters are warnings in the editor and never block Inject or Export.
- Exports enlarge the text windows so longer English is no longer cut off after about 80 characters.
- A script that outgrows its disc space reuses the space of the developer-menu test scripts. The ISO size is unchanged.
- Em dashes (—) and similar punctuation from editors and AI translation are converted to their Shift-JIS forms instead of being refused. Errors for unsupported characters now name the character.
- Existing projects are upgraded to the new limits when opened. Saves made before re-exporting may not resume correctly.

## 0.5.2 (2026-11-26)

- New projects include an editable Actor Reference with character names, pronouns, and speech guidance for AI translation. The player-named daughter is labeled Daughter.
- Added compact, language-neutral prompts and CP932 refinement checks. Requires Translator++ 8.11.9 or newer.

## 0.5.1 (2026-11-26)

- Fixed missing speaker names on dialogue that continues across page advances and portrait changes, including lines spoken by the player-named daughter.

## 0.5.0 (2026-11-26)

- Added a 12-character English name option in Inject. The surname and given name use half-width letters, and the keyboard parchment has been cleaned up.

## 0.4.1 (2026-11-26)

- Fixed injection and PNG export for projects with empty image translation rows, including sheets edited in Krita.

## 0.4.0 (2026-11-26)

- Load all 1,263 game artwork sheets, including CGs without text, in a new project or from the Tools menu. Edit them in Krita or export and re-import PNGs to create a patched ISO.

## 0.3.1 (2026-11-25)

- Added a character portrait icon for the add-on and its New Project entry.

## 0.3.0 (2026-11-25)

- First release on GitHub. Install it from Translator++ under Options → Add-ons → Install → Community add-ons.
