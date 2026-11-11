---
name: Authenticated test safety
description: Programmatic Clerk session delays and safe cleanup of internal-app test fixtures.
---

Programmatic Clerk login can remain on the session-loading screen for more than twenty seconds and then load correctly without source changes. Observe the loaded/member state and API responses before diagnosing an authentication defect from one screenshot.

**Why:** A focused signed-in video test initially appeared blocked, but the same identity and route subsequently completed the whole journey without an authentication change.

**How to apply:** Continue the same tester and existing synthetic fixtures; wait for the actual page controls and inspect errors before modifying authentication or repeating a broad suite.

Clean up only the exact test identities and data recorded during setup. Match the recorded identity and test email rather than guessing a restrictive username pattern or deleting accounts by role.

**Why:** Generated test names can contain punctuation such as underscores; an inferred pattern rejected a legitimate fixture during cleanup. The owner's account and real company data must never be included.

**How to apply:** Record synthetic identities at creation, verify those exact identities before deletion, and preserve real users, source approvals, and unrelated data.

Overridden programmatic Clerk login claims can differ from the profile returned by Clerk's user API. A test manifest's claimed email/name is not proof that a disposable Clerk profile with those attributes was created.

**Why:** Cleanup encountered a mismatch between the recorded test claims and the actual Clerk profile. Deleting that profile would have relied on an unverified ownership assumption.

**How to apply:** Verify the actual Clerk identity before deleting it. If it does not match, preserve it; clean only the precisely verified synthetic application rows and private objects, and report the skipped identity deletion honestly.
