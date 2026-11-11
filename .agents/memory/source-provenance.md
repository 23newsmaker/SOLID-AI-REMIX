---
name: Source provenance in task workspaces
description: Preserve uploaded originals when a task workspace arrives with unrelated conversation-asset deletions.
---

Inspect inherited deletions before completing a feature task. The task workspace can arrive with deleted conversation attachments, and those deletions can enter the feature's eventual changes even when no feature edit touched them.

**Why:** An isolated workspace carried removal of original KB archives and reference videos. Extracted files in ignored storage and imported private objects did not replace the original uploaded provenance.

**How to apply:** Compare the source-attachment tree against the current main branch when reconciling. Preserve the original bytes, including archives and videos; do not treat an inherited deletion as owner permission to discard them. Restore only the affected provenance paths, not unrelated feature or owner edits.
