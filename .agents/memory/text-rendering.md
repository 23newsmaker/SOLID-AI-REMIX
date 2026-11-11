---
name: Raster text bounds
description: Why SVG textLength cannot enforce subtitle or disclaimer bounds in the local renderer.
---

Do not rely on SVG `textLength` / `lengthAdjust` to fit text when rasterizing through Sharp/librsvg. Use actual glyph-aware wrapping and check the raster dimensions before accepting a render job.

**Why:** A pixel-bound test of 56 wide letters showed librsvg ignored the requested width and clipped the line across the full canvas. Character counts alone also fail for wide glyphs.

**How to apply:** Keep numbers and wording intact, reject overflow before consuming a generation slot, never silently truncate or shrink approved content, and keep technical checks separate from human readability/compliance review.
