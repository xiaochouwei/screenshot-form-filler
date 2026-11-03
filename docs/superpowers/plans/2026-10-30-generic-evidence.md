# Generic Form Evidence Implementation Plan

**Goal:** Apply one source-evidence, selection, scanning and validation policy across websites; preserve local OCR as the primary source and exact target matching.

**Approved Design:** The user approved the generic pipeline and requested reflection before implementation. Execute in this session. No website names, business captions or URLs become production rules. Existing input/choice writers and readback remain the execution layer.

## Constraints

- No cloud, new dependencies, host permissions, auto-submit or arbitrary business actions.
- Sources remain screenshots from any application; DOM evidence is optional and belongs to the captured source, never the target.
- Ambiguity, true character/whitespace changes and manual exclusions must not be silently resolved.
- Participation is separate from verification. New records default selected; pending/conflict records cannot fill until reviewed. Legacy unchecked records remain unchecked.
- Soft-wrap corroboration requires measured source rendering evidence; no global whitespace removal or fuzzy matching.
- Report rendered logical fields, unsupported and unnamed fields, raw candidates, grouping, frame gaps and transient scans. Do not claim access to closed roots, virtualized or not-yet-rendered components.

## Tasks

- [x] Add failing tests for selection/review independence, legacy exclusion, true conflicts and measured soft-wrap equivalence. Implement shared row-state helpers and reconciliation with original OCR evidence retained.
- [x] Add browser fixtures for wrapped versus genuinely multiline native textareas, clipped values and long punctuation-rich text. Measure supported native text layout and include evidence in source capture.
- [x] Add browser tests for semantic discovery, adjacent action inputs, label ambiguity, loading settlement and counts. Improve generic discovery, diagnostics and bounded stable scanning without clicking controls.
- [x] Connect state to matching, auto-confirmation, editor, history and shelf. Explicit review actions verify pending values; selection alone does not. Preserve deselection across restore and automatic verification.
- [x] Run focused and full regression, review screenshots, update version/docs, package existing delivery directories and verify archive hashes.

## Verification Matrix

Native HTML/ARIA and existing iView/Element/Ant fixtures; unrelated labels/layouts; open Shadow DOM; frame gaps; duplicates; unsupported roles; delayed rendering; literal spaces/newlines; source conflicts; old records; manual exclusions. Use real pointer gestures for the shelf. Fixtures test generic cases and do not guarantee every site.

## Completion Review

Verify no site branches, no relaxed exact matching, no confirmation from merely selecting a checkbox, and no claim that unavailable content was scanned. Document remaining limits.
