import { Module } from "@nestjs/common";
import { PlatformModule } from "../bootstrap/platform.module.js";
import { HealthController } from "./health.controller.js";
import { MetricsController } from "./metrics.controller.js";

@Module({
  imports: [PlatformModule],
  controllers: [HealthController, MetricsController],
})
export class HealthModule {}
