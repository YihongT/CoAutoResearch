# Maintaining README translations

English (`../README.md`) is the source of truth. The ten translations cover the
same sections, commands, capabilities and limitations. They translate the README,
not the application interface or the complete English documentation.

## Updating a translation

1. Read the English change and update the corresponding content in every affected
   translation. Preserve command blocks, model names and visible UI labels.
2. Keep relative links correct from `readme/`. Reuse the shared screenshots and
   diagrams; do not duplicate translated image assets.
3. Review meaning, numbers, approval boundaries and bidirectional text. Arabic
   prose uses RTL blocks; commands remain left-to-right.
4. After synchronizing content, update that language's `source_sha256` in
   `translations.json` to the SHA-256 of the exact English README bytes.
5. Run the README workflow. It checks source freshness, language coverage, local
   links and shared command blocks; it cannot establish translation accuracy.

The initial translations were prepared with AI assistance. Native-language review
is pending and tracked explicitly in the manifest. Corrections are welcome through
Issues or a focused pull request. Do not mark a translation as reviewed without a
real reviewer. A hash update alone is not a translation review.
