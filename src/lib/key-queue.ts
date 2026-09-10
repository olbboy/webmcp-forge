/**
 * Serializes async work per key within one process.
 *
 * Two callers exist for two different reasons. Job state lives in a JSON file
 * with no locking, so two concurrent writes to the same job silently lose one
 * of them. Workers KV accepts only one write per second to a single key, so
 * two concurrent publishes to the same public id can be rejected.
 */
export function createKeyQueue() {
  const tails = new Map<string, Promise<void>>();

  return function runSerialized<T>(
    key: string,
    work: () => Promise<T>
  ): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    const run = previous.then(work);
    // The queued copy swallows rejections so one failure cannot reject every
    // caller that lines up behind it.
    const tail = run.then(
      () => undefined,
      () => undefined
    );
    tails.set(key, tail);

    return run.finally(() => {
      // Clear only if nobody queued behind us, so the chain stays intact.
      if (tails.get(key) === tail) tails.delete(key);
    });
  };
}
