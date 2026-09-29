import { Controller, Get, Header } from "@nestjs/common";
import { renderMetrics } from "@commerce-flow/observability";

@Controller()
export class MetricsController {
  @Get("metrics")
  @Header("content-type", "text/plain; version=0.0.4; charset=utf-8")
  public metrics(): Promise<string> {
    return renderMetrics();
  }
}
