# Working on pm4Ps2

This parser supports the Japanese PS2 release SLPM_659.36. Use the
[PM4 case map](../../docs/console-rom-parser/cases/pm4-ps2.md) to select relevant
README/plan sections before changing format logic. Do not load unrelated case
notes or apply PC patch offsets/GCEX assumptions to the PS2 disc.

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
   from the repository root. Also exercise New Project, reopen, folder/zip export,
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
The English keyboard is explicit opt-in on Inject. Preserve two-byte input slots,
row terminators, executable instructions and all bytes outside the two table
regions. Patch both page images and tables together, regardless of selected files.
