---
name: Worker lifecycle and hosting approval
description: Why idle optimization is not evidence that in-process rendering survives Autoscale shutdown.
---

Keep cost optimization separate from production lifecycle approval. A render continuing after its browser page closes proves independence from browser polling, not survival of server-instance shutdown.

**Why:** DR required retaining the existing architecture and controls while reducing idle work, forbade paid hosting activation/publishing, and explicitly required actual evidence before declaring Autoscale safe.

**How to apply:** Report bounded measurements as bounded measurements. Persistent queue/reconciliation can preserve an UNKNOWN job without guaranteeing completion. Do not recommend Autoscale publication solely from adaptive backoff, a closed browser page, or an isolated worker restart; any production lifecycle redesign or paid always-on hosting needs separate agreement.
