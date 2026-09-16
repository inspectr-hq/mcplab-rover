let operationTail: Promise<void> = Promise.resolve();

export function serializeQueueOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationTail.then(operation, operation);
  operationTail = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}
