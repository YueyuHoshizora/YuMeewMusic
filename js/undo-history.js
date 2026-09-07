const clone = value => typeof structuredClone === 'function'
  ? structuredClone(value)
  : JSON.parse(JSON.stringify(value));

export function createUndoHistory(limit = 10) {
  const maximum = Math.max(1, Math.floor(limit));
  const past = [], future = [];
  const keepLatest = stack => { while (stack.length > maximum) stack.shift(); };
  return {
    checkpoint(value) {
      past.push(clone(value));
      keepLatest(past);
      future.length = 0;
    },
    undo(current) {
      if (!past.length) return null;
      future.push(clone(current));
      keepLatest(future);
      return clone(past.pop());
    },
    redo(current) {
      if (!future.length) return null;
      past.push(clone(current));
      keepLatest(past);
      return clone(future.pop());
    },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
    get undoCount() { return past.length; },
    get redoCount() { return future.length; },
  };
}
