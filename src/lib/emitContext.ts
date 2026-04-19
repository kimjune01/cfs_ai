import { AsyncLocalStorage } from "async_hooks";

import type { EmitFn, TraceEvent } from "./types";

const emitStorage = new AsyncLocalStorage<EmitFn>();

const runWithEmit = <T>(fn: () => Promise<T>, emitFn: EmitFn): Promise<T> =>
  emitStorage.run(emitFn, fn);

const emit = (event: TraceEvent): void => {
  emitStorage.getStore()?.(event);
};

export { emit, runWithEmit };
