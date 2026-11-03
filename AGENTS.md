# Product and Change Principles

Before changing behavior, review the product goal, trace the failure to its shared cause, and state what evidence will validate the change. Record material decisions and observed limitations in the verification report.

- Sources are arbitrary screenshots. Local OCR is primary; source-page DOM may corroborate the captured image. Target DOM never substitutes source values.
- Targets are browser forms. Use exact, unique field and option matching. Preserve existing content and manual exclusions. Never submit automatically.
- Apply semantic, structural and adapter rules across sites. Do not add business captions, site URLs or screenshot-specific coordinates to production matching.
- Keep participation separate from content verification. Default participation must never authorize uncertain or conflicting evidence.
- Report unsupported, inaccessible and unrendered coverage honestly. An inventory does not imply a working writer.
- Reproduce with independent labels/layouts and negative cases before a fix. Verify the actual extension flow, not only helper functions.
- Keep capture, shelf drag and the fill button consistent. No cloud, desktop client, new permissions or dependencies without a product need and authorization.

Use `npm run test:regression` for shared pipeline changes. Before delivery, verify the loaded extension directories and ZIP contents against the built output and include the results in the versioned verification report.
