# Student-side completion tracker

Updated November 11, 2026. Teacher-side work is outside this scope.

## Implemented in this milestone

- Durable Journey drafts: saved on device, synced with markers, restored from backups.
- Structured breakthroughs with backward-compatible Markdown history.
- Unresolved → Working through → Understood progress, independent of recall mastery.
- Unresolved/working-through filter in marker search, including Journey draft text.
- Exact source-quote validation for new AI replies, expandable excerpts and stale-source warnings.
- Read-only note opens update local recency without queuing a content upload or creating a false edit conflict.
- Sync transaction guards: newer local edits survive upload acknowledgments and remote/conflict application; queued writes retain acknowledged server revisions.
- Deterministic race regression tests, plus browser, backup and cross-device Journey coverage.

## Milestones and remaining gates

| Milestone | State | Still needed |
| --- | --- | --- |
| Core notes and markers | Implemented | Continue checking regressions against real course material. |
| Data reliability | Hardened; validation ongoing | Confirm on real devices. Investigate any further intermittent CI failures; the reproduced transaction races are fixed, but their causal link to the earlier CI timeout is unproven. |
| Marker lifecycle | Implemented | Pilot feedback on progress language and unfinished-point discovery. |
| Trustworthy AI | Source-tracing foundation implemented | Real-model quality evaluation, reliable cancellation/retry/resumption, and claim-level support checks. Quote matching alone does not establish correctness. |
| Real services | Not verified | Staging hosting, Supabase schema/auth, SMTP, AI keys, quotas, backup/restore and rollback checks. |
| Student-device usability | Desktop browser checked | Physical iPad and Windows tests, touch selection, software keyboard, offline cold start and accessibility. |
| Closed pilot | Not started | 10–20 students, one course, two weeks; observe voluntary return use and record friction/costs. |

## Deferred product work

Original PDF page rendering and coordinate anchors; OCR; handwriting; tables; resumable/streaming AI jobs; misconception-aware recall variants; richer conflict recovery that preserves marker links in note copies.

## Pilot gate

A student can import → mark → understand → close → reopen → recall → sync → recover using real services on real devices without assistance. Automated tests are necessary but do not replace this check.
