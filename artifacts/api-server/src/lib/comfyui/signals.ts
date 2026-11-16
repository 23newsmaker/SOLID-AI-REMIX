import { EventEmitter } from "node:events";

// Hint only; database rows stay the source of truth. Separate module to avoid a circular import.
const signals = new EventEmitter();
export const notifyComfyWork = () => { signals.emit("work"); };
export const onComfyWork = (wake: () => void) => { signals.on("work", wake); return () => { signals.off("work", wake); }; };
