import { Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { PlatformModule } from "./bootstrap/platform.module.js";
import { HealthModule } from "./health/health.module.js";
import { ApiExceptionFilter } from "./middleware/api-exception.filter.js";
import { RequestLoggingInterceptor } from "./middleware/request-logging.interceptor.js";
import { GatewayModule } from "./modules/gateway/gateway.module.js";

@Module({
  imports: [PlatformModule, HealthModule, GatewayModule],
  providers: [
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
  ],
})
export class AppModule {}
