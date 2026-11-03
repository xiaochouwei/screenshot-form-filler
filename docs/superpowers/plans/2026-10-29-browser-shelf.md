# Browser Screenshot Shelf Implementation Plan

**Goal:** Capture or import any screenshot, keep a local image shelf shared by permitted webpages, and fill browser forms by dragging or an explicit command.

**Approved design:** The user's approved design in this conversation: OCR first; optional source DOM; exact unique matching; no overwrite, submit, cloud processing, or desktop client. Preserve explicit state synchronization.

**Architecture:** Keep the existing content scanner and writer. Add an isolated in-page shelf, a serialized background history service, and an extension processing document using the existing OCR modules. The panel remains the detailed editor and fallback. Screenshot records are immutable by identity and version; page updates cannot overwrite a different screenshot.

**Tech stack:** Manifest V3, JavaScript, bundled PaddleOCR/Tesseract, chrome.storage.local, Playwright, Node test runner. No new dependencies.

## Tasks

- [x] History: test add/update/select/delete/eviction/migration and stale updates; implement bounded local records with stable IDs and serialized writes in background.
- [x] Shelf: test a real browser mouse drag from thumbnail to form (without dispatched drop), button fill, multiple form selection, exact matching and occupied-field protection. Implement a shadow-root shelf that is excluded from source scanning/capture. Preserve detailed field review.
- [x] Processing: capture/paste/file import automatically queue local OCR; save a normalized local image before OCR, retain per-image errors and status; source DOM remains auxiliary. Test real image recognition and navigation/persistence.
- [x] Entry and authorization: extension icon opens shelf on ordinary webpages; settings have explicit site access choices and shortcut settings. Keep existing panel available.
- [x] Integration: existing panel changes update only their selected record; delete and clear do not resurrect history; render operation outcomes next to the form.
- [x] Verification: run full regression, actual pointer drag and desktop/narrow viewport screenshots; package extension and source, verify hashes. Report the distinction between browser pointer tests and unavailable OS-level input.

## Acceptance

Capture -> automatic recognition -> same record on another permitted website -> complete real pointer drag -> exact fields filled/read back, existing values preserved, no submit. Multiple forms require a target. Deleting an active record during recognition does not resurrect it. No image bytes or values travel in drag data. Offline OCR remains offline.
