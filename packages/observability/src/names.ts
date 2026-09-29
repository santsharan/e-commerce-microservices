export const MetricName = {
  httpRequestDurationSeconds: "http_request_duration_seconds",
  httpRequestsTotal: "http_requests_total",
  kafkaMessagesConsumedTotal: "kafka_messages_consumed_total",
  kafkaMessagesFailedTotal: "kafka_messages_failed_total",
  kafkaConsumerLag: "kafka_consumer_lag",
  ordersCreatedTotal: "orders_created_total",
  ordersCompletedTotal: "orders_completed_total",
  ordersFailedTotal: "orders_failed_total",
  ordersCancelledTotal: "orders_cancelled_total",
  sagaDurationSeconds: "saga_duration_seconds",
  sagaFailuresTotal: "saga_failures_total",
  inventoryReservationSuccessTotal: "inventory_reservation_success_total",
  inventoryReservationFailureTotal: "inventory_reservation_failure_total",
  paymentAuthorizationSuccessTotal: "payment_authorization_success_total",
  paymentAuthorizationFailureTotal: "payment_authorization_failure_total",
  cacheHitsTotal: "cache_hits_total",
  cacheMissesTotal: "cache_misses_total",
  mongodbQueryDurationSeconds: "mongodb_query_duration_seconds",
} as const;

export type MetricName = (typeof MetricName)[keyof typeof MetricName];

export function metricNames(): readonly MetricName[] {
  return Object.values(MetricName);
}
