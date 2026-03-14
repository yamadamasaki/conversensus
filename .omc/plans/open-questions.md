# Open Questions

## step0-tauri-graph-editor - 2026-03-14

- [ ] CSS approach: Tailwind CSS vs CSS Modules vs plain CSS -- Minor decision, executor can choose based on preference. — Affects developer velocity and consistency.
- [ ] Node default size and text overflow behavior (fixed width with scroll, auto-expand, or truncate with tooltip) — Affects usability for long text content.
- [ ] Edge routing style preference: straight lines, bezier curves, or step edges — Affects visual clarity of complex graphs; React Flow supports all three.
- [ ] File extension `.conversensus.json` vs `.cvs` or similar shorthand — Affects OS file association and user convenience.
- [ ] Whether to include auto-layout (dagre/elkjs) in Step 0 or defer entirely to function step 1 — Could significantly improve UX for initial graph creation but adds scope.
- [ ] Minimum supported macOS version for Tauri v2 (currently 10.13+) — May affect some users; needs verification against Tauri v2 docs.
