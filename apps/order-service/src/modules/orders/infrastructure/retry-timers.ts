import { Injectable } from "@nestjs/common";
import type { RetryScheduler } from "../application/ports.js";

@Injectable()
export class SagaRetryTimers implements RetryScheduler {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private resume: ((orderId: string) => Promise<void>) | undefined;

  public bind(resume: (orderId: string) => Promise<void>): void {
    this.resume = resume;
  }

  public schedule(orderId: string, at: Date): void {
    const existing = this.timers.get(orderId);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    const delay = Math.max(0, at.getTime() - Date.now());
    const timer = setTimeout(() => {
      this.timers.delete(orderId);
      void this.resume?.(orderId);
    }, delay);
    timer.unref();
    this.timers.set(orderId, timer);
  }

  public stop(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}
