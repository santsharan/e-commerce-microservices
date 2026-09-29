import { Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { PlatformModule } from "./bootstrap/platform.module.js";
import { HealthModule } from "./health/health.module.js";
import { ApiExceptionFilter } from "./middleware/api-exception.filter.js";
import { RequestLoggingInterceptor } from "./middleware/request-logging.interceptor.js";
import { NotificationsModule } from "./modules/notifications/notifications.module.js";

@Module({
  imports: [PlatformModule, HealthModule, NotificationsModule],
  providers: [
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
  ],
})
export class AppModule {}
