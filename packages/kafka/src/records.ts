import { AppError, ErrorCode } from "@commerce-flow/errors";
import {
  EventType,
  parseDomainEvent,
  topicForEvent,
  type DomainEvent,
} from "@commerce-flow/events";
import { partitionKey } from "./partition.js";

const knownEventTypes = new Set<string>(Object.values(EventType));

function isEventType(value: string): value is EventType {
  return knownEventTypes.has(value);
}

export interface ProducerRecord {
  topic: string;
  key: string;
  value: string;
}

/**
 * Maps a domain event onto the topic and aggregate partition key.
 * Unknown event names are rejected so a typo cannot create a topic.
 */
export function producerRecord(event: DomainEvent<unknown>): ProducerRecord {
  if (!isEventType(event.eventType)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Unknown event type", 400, {
      eventType: event.eventType,
    });
  }
  return {
    topic: topicForEvent(event.eventType),
    key: partitionKey(event.aggregateId),
    value: JSON.stringify(event),
  };
}

/**
 * Parses one Kafka record value into the version 1 envelope.
 * The raw payload is not copied into the error.
 */
export function decodeMessage(value: Buffer | string | null): DomainEvent<unknown> {
  if (value === null) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Kafka message has no value", 400, {});
  }
  const text = typeof value === "string" ? value : value.toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Kafka message is not valid JSON", 400, {});
  }
  try {
    return parseDomainEvent(parsed);
  } catch {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Kafka message is not a domain event", 400, {});
  }
}
