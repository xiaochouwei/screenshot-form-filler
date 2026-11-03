# Drag Window And Choice Controls Implementation Plan

> Use superpowers:subagent-driven-development for the independent choice-control module, then integrate and verify in the root task.

Goal: capture a selected webpage region, retain exact DOM values when available, open a compact draggable extension window, and fill the form under a drop in another authorized browser window.

Architecture: the background stores a short-lived one-use drag capability. Authorized receiver content scripts claim it using their actual tab/document identity. A compact mode of panel.html reuses local image/OCR persistence. A controls module describes and writes native and explicitly identifiable custom choice controls. Screenshots remain local.

Constraints: same browser profile; no cloud; no fuzzy names; no text overwrite; state synchronization opt-in; no submit/delete/add-row commands; skip ambiguous/unsupported choices; keep sidebar available for detailed inspection.

- [x] Add choice validation and native/ARIA/common-framework choice adapters with tests. Interface: controls.js exports controlNodes(root), choiceInfo(node), readChoice(node), writeChoice(node, entry), choiceLabel(node); core.js exports validRows(rows) and planMatches(rows,targets,{syncStates=false}). Rows keep string value and optional values:string[] / checked:boolean / kind:string.
- [x] Integrate choice adapters with content scan, source capture, preview and fill. Record selected-region source bounds and only include fully contained fields. Test source scope and opt-in state updates.
- [x] Replace pre-bound target drag with background REGISTER_DRAG/CLAIM_DRAG and document identity checks. Inject receivers only with activeTab or optional host access. Highlight actual drop form and prohibit replay/navigation reuse. Test two-window routing and ambiguous drops.
- [x] Open/reuse compact popup after selection. Add target connection controls, state-sync checkbox, collapsed details and local result feedback. Preserve paste/import. Test real crop-to-popup and small viewport screenshots.
- [x] Run original regressions and new end-to-end tests, package and hash-check installed/delivered files. Document supported controls and physical dual-monitor verification limits.

Verification: 21 unit/protocol tests passed; browser, choices-browser, labels-browser, window-drop, region-browser, quick-entry, drag-batch, extension, screenshot-layout, generic-workflow and workflow suites passed. Reviewed 360px dock and form highlight screenshots. Verified 29 built files by SHA-256 against both delivery directories and extension ZIP; verified source trees. Version 0.5.0 retains original production permissions. Physical dual-monitor mouse drag, native command dispatch, user Edge and business-site behavior require on-device confirmation.
