import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import {
  readinessFromChecks,
  type ReadinessReport,
  type ServiceDependencies,
} from "@commerce-flow/observability";

/**
 * Holds the clients opened by `bootstrap`.
 * `createApp()` leaves this empty so unit tests stay process-only and do not need Docker.
 * Shutdown closes Kafka, Redis, and MongoDB after Nest stops HTTP.
 */
@Injectable()
export class ResourceRegistry implements OnApplicationShutdown {
  private dependencies: ServiceDependencies | undefined;

  public attach(dependencies: ServiceDependencies): void {
    this.dependencies = dependencies;
  }

  public opened(): ServiceDependencies | undefined {
    return this.dependencies;
  }

  public async readiness(): Promise<ReadinessReport> {
    if (this.dependencies === undefined) {
      return readinessFromChecks({ process: "ok" });
    }
    return readinessFromChecks(await this.dependencies.ping());
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.dependencies?.close();
  }
}
