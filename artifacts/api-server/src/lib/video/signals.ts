import { EventEmitter } from "node:events";

// Separate from worker/service to avoid a circular import. Signals are hints;
// database rows remain the source of truth and survive lost signals/restarts.
const signals = new EventEmitter();
export const notifyVideoWork = () => { signals.emit("work"); };
export const onVideoWork = (wake: () => void) => {
  signals.on("work", wake);
  return () => { signals.off("work", wake); };
};
