# Working on pm4Ps2

This parser supports the Japanese PS2 release SLPM_659.36. Use the
[case map](plan/case-map.md) to select relevant
README/plan sections before changing format logic. Do not apply PC patch
offsets/GCEX assumptions to the PS2 disc.

1. Keep measured signatures, encoding, extraction rules, and limitations in
   plan/README.md current. Retail game bytes must not be committed as fixtures.
2. Keep scan(), parseFile(), writeFile(), and exportIso() in pm4Ps2.module.js.
   Keep the business logic callable from plain Node.js and worker_threads.
   SPD/PNG logic belongs in pm4Ps2.images.js; browser/Images-pane integration
   belongs in pm4Ps2.image-ui.js and receives host objects explicitly.
   Optional native keyboard tables and key-label patches belong in pm4Ps2.keyboard.js.
3. Use pm4Ps2.js only for Translator++ UI and AddonUtils integration.
   Top-level `this` there is the Addon instance. Never require that entry as
   a Node module. Persist options needed after reopening in project.options.init.
4. Keep the wizard, serial/format detector, and whole-disc export hooks aligned.
   Display byte budgets in the toolbar; bulk cell comments redraw once per row
   in the host and make the main script unusable.
5. Add format fixtures and tests: extraction/context/speaker metadata, unchanged
   export round trip, translated output, duplicate strings in different contexts,
   multiline/control-code preservation, malformed input, and missing translations.
6. Run `node --test www/addons/pm4Ps2/test/pm4Ps2.module.test.js`
   and `node --test www/addons/pm4Ps2/test/pm4Ps2.images.test.js`
   and `node --test www/addons/pm4Ps2/test/pm4Ps2.keyboard.test.js`
   from the Translator++ root. Also exercise New Project, reopen, folder/zip export,
   inject, and update in Translator++. Verify module loading after compilation.

Do not modify original game resources during extraction or export. Preserve
encoding/BOM, newline style, syntax, binary offsets/lengths, and non-text data.
Use the same file IDs and contexts for extraction and writing. Use the resolved
translationPair supplied by AddonUtils instead of guessing a target column.

Read these repository references before inventing an API:

- `www/js/ParserBase.js`: registerString/register, context, filters, getText/toTrans.
  It currently needs host globals `common` and `empty`; requiring it alone is
  insufficient in standalone Node/worker runtimes. See the module's recipe.
- `www/js/AddonUtils.js`: createProject, per-file hooks, export/inject/update.
- `www/js/jsonform.ext.js`, `www/js/CustomFields.js`: supported form controls.
- `www/js/addon.js`: loader and Addon paths; entry script execution model.
- `www/addons/unrealParser/unreal.js`, `unreal.module.js`, `package.json`: example
  of UI integration, archive staging, portable business logic, and compilation.
- `www/docs/parser-developer-guide-ai.md`, `parser-base-developer-guide-ai.md`,
  `addon-developer-guide-ai.md`, `trans.md`: detailed contracts (all under www/docs).

The tests generate synthetic G2 scripts and nested ISO/CVM fixtures. Extend those
when changing format logic, and verify against a local retail disc without
redistributing it. The worker is a source-only development helper, excluded from
compiled packages. Runtime parsing is through the CommonJS module directly.
Image changes require a verified PNG → SPD → ISO → PNG round trip, unchanged
sprite metadata/ISO extents, and preserved PS2 alpha. Generic Image Translator
injection temporarily hides image files: use imageTranslatorFiles and mark
imageTranslatorHandled after packing them. Never ship loose PNGs as if injected.
The English keyboard is explicit opt-in on Inject. Preserve two-byte input slots
and row terminators. The full-width mode changes only the two tables in the
executable. The long-name mode also changes the guarded name-entry instructions
on the verified retail ELF and requires both name prompts. Patch all resources
for the selected mode together, regardless of selected files.

## Repository and releases

This folder is its own git repository,
[pismax/tpp-pm4Ps2](https://github.com/pismax/tpp-pm4Ps2), cloned at
`<Translator++>/www/addons/pm4Ps2` so the app loads it and the tests can require
`www/js/...`. Commit here as `pismax <360907843+pismax@users.noreply.github.com>`
(set in this clone's git config). Never commit these files to the Translator++
repository, and never add other identities, emails or local paths.

To release:

1. Bump `version` in `package.json` (and the top-level and root-package
   versions in `package-lock.json` when present). Raise `minimumVersion` when
   the code needs a newer Translator++.
2. Describe the user-facing change under a new version heading in
   `CHANGELOG.md`.
3. Run the tests above, commit, then `git tag v<version>` and
   `git push origin main v<version>`. Never move a published tag.
4. In the catalog repository [pismax/tpp-addons](https://github.com/pismax/tpp-addons),
   set this add-on's `ref` to the new tag, update its README table, run
   `node scripts/validate-catalog.js`, and push. Translator++ offers the update
   within a few minutes.
