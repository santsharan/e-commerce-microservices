import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Res,
} from "@nestjs/common";
import { API_PREFIX } from "@commerce-flow/contracts";
import { AppError, ErrorCode } from "@commerce-flow/errors";
import { z } from "zod";
import { CatalogApplication } from "../application/catalog-application.js";
import { versionFromIfMatch } from "../domain/concurrency.js";
import { etagFor } from "../domain/product.js";

const categorySchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(80).optional(),
});

interface HeaderReply {
  header(name: string, value: string): void;
}

@Controller(`${API_PREFIX.slice(1)}/categories`)
export class CategoriesController {
  public constructor(private readonly catalog: CatalogApplication) {}

  @Post()
  @HttpCode(201)
  public async create(
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: HeaderReply,
  ): Promise<unknown> {
    const parsed = parse(categorySchema, body);
    const category = await this.catalog.createCategory({
      name: parsed.name,
      ...(parsed.slug === undefined ? {} : { slug: parsed.slug }),
    });
    reply.header("etag", etagFor(category.version));
    return category;
  }

  @Get()
  public list(): Promise<unknown> {
    return this.catalog.listCategories();
  }

  @Get(":id")
  public async get(
    @Param("id") id: string,
    @Res({ passthrough: true }) reply: HeaderReply,
  ): Promise<unknown> {
    const category = await this.catalog.getCategory(id);
    reply.header("etag", etagFor(category.version));
    return category;
  }

  @Patch(":id")
  public async update(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) reply: HeaderReply,
  ): Promise<unknown> {
    const parsed = parse(categorySchema.partial(), body);
    const category = await this.catalog.updateCategory(id, versionFromIfMatch(ifMatch), {
      ...(parsed.name === undefined ? {} : { name: parsed.name }),
      ...(parsed.slug === undefined ? {} : { slug: parsed.slug }),
    });
    reply.header("etag", etagFor(category.version));
    return category;
  }

  @Delete(":id")
  @HttpCode(204)
  public async remove(
    @Param("id") id: string,
    @Headers("if-match") ifMatch: string | undefined,
  ): Promise<void> {
    await this.catalog.deleteCategory(id, versionFromIfMatch(ifMatch));
  }
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) {
    return parsed.data;
  }
  const fields = [
    ...new Set(
      parsed.error.issues.map((issue) => {
        const field = issue.path[0];
        return typeof field === "string" ? field : "body";
      }),
    ),
  ];
  throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid request", 400, { fields });
}
