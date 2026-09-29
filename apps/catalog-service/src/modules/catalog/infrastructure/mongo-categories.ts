import type { ResourceRegistry } from "../../../bootstrap/resources.js";
import type { CategoryRepository } from "../application/ports.js";
import type { Category } from "../domain/product.js";
import { duplicateCategory } from "./indexes.js";
import { isDuplicateKey } from "./redis-catalog-cache.js";
import { requireMongo } from "./mongo-support.js";

interface CategoryDocument {
  id: string;
  name: string;
  slug: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class MongoCategoryRepository implements CategoryRepository {
  public constructor(private readonly registry: ResourceRegistry) {}

  public async insert(category: Category): Promise<void> {
    try {
      await requireMongo(this.registry)
        .database.collection<CategoryDocument>("categories")
        .insertOne({ ...category });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw duplicateCategory();
      }
      throw error;
    }
  }

  public async findById(id: string): Promise<Category | null> {
    const document = await requireMongo(this.registry)
      .database.collection<CategoryDocument>("categories")
      .findOne({ id });
    return document === null ? null : toCategory(document);
  }

  public async list(): Promise<Category[]> {
    const documents = await requireMongo(this.registry)
      .database.collection<CategoryDocument>("categories")
      .find()
      .sort({ name: 1 })
      .toArray();
    return documents.map(toCategory);
  }

  public async update(
    id: string,
    version: number,
    category: Category,
  ): Promise<Category | "missing" | "conflict"> {
    const updated = await requireMongo(this.registry)
      .database.collection<CategoryDocument>("categories")
      .findOneAndUpdate(
        { id, version },
        {
          $set: {
            name: category.name,
            slug: category.slug,
            updatedAt: category.updatedAt,
            version: version + 1,
          },
        },
        { returnDocument: "after" },
      );
    if (updated !== null) {
      return toCategory(updated);
    }
    const existing = await this.findById(id);
    return existing === null ? "missing" : "conflict";
  }

  public async delete(id: string, version: number): Promise<"deleted" | "missing" | "conflict"> {
    const deleted = await requireMongo(this.registry)
      .database.collection<CategoryDocument>("categories")
      .deleteOne({ id, version });
    if (deleted.deletedCount === 1) {
      return "deleted";
    }
    const existing = await this.findById(id);
    return existing === null ? "missing" : "conflict";
  }
}

function toCategory(document: CategoryDocument): Category {
  return {
    id: document.id,
    name: document.name,
    slug: document.slug,
    version: document.version,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}
