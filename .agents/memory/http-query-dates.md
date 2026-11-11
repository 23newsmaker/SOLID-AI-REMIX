---
name: HTTP query dates
description: Why date filters use ISO string contracts rather than generated Date validators.
---

Keep date-only HTTP query inputs as YYYY-MM-DD strings with a pattern and actual calendar-date validation. Convert dates only inside the domain calculation, preserving Jakarta day boundaries.

**Why:** The project's generator maps OpenAPI `format: date` query inputs to a non-coercing JavaScript Date validator. Real HTTP query values are strings, so valid date-picker inputs were rejected. A compile check did not catch this transport mismatch.

**How to apply:** For new date filters, verify a real string query against the generated validator. Do not restore `format: date` without configuring and checking coercion end to end. This does not change timestamp response conventions.
