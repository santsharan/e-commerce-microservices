export function partitionKey(aggregateId: string): string {
  const key = aggregateId.trim();
  if (key.length === 0) {
    throw new Error("Kafka records are partitioned by aggregate id");
  }
  return key;
}
