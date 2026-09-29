import { Controller, Get, Res } from "@nestjs/common";
import type { LivenessReport, ReadinessReport } from "@commerce-flow/observability";
import { ResourceRegistry } from "../bootstrap/resources.js";

interface StatusReply {
  status(code: number): { send(body: ReadinessReport): void };
}

@Controller("health")
export class HealthController {
  public constructor(private readonly resources: ResourceRegistry) {}

  @Get("liveness")
  public liveness(): LivenessReport {
    return { status: "ok" };
  }

  /**
   * Liveness never checks dependencies.
   * Readiness pings clients attached by bootstrap and returns 503 when one is down.
   * Without attached clients the process reports itself ready, which is what the unit tests use.
   */
  @Get("readiness")
  public async readiness(@Res() reply: StatusReply): Promise<void> {
    const report = await this.resources.readiness();
    reply.status(report.status === "ok" ? 200 : 503).send(report);
  }
}
