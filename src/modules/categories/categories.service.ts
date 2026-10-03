import type { Database } from '../../database/client.js';
import { AppError, ensure } from '../../shared/errors.js';
import type {
  CreatePersonalCategoryInput,
  UpdatePersonalCategoryInput,
} from './categories.schema.js';

const categoryView = { id: true, groupId: true, name: true, color: true } as const;

function throwDuplicate(error: unknown): void {
  if (error && typeof error === 'object' && (error as { code?: string }).code === 'P2002') {
    throw new AppError(409, 'CATEGORY_EXISTS', 'Ya existe una categoria con ese nombre');
  }
}

/** Categorias personales, separadas de las categorias administradas por cada grupo. */
export class PersonalCategoriesService {
  constructor(private readonly db: Database) {}

  list(userId: string) {
    return this.db.category.findMany({
      where: { ownerUserId: userId },
      select: categoryView,
      orderBy: { name: 'asc' },
      take: 200,
    });
  }

  async create(userId: string, input: CreatePersonalCategoryInput) {
    try {
      return await this.db.category.create({
        data: {
          ownerUserId: userId,
          name: input.name,
          ...(input.color ? { color: input.color } : {}),
        },
        select: categoryView,
      });
    } catch (error) {
      throwDuplicate(error);
      throw error;
    }
  }

  async update(userId: string, categoryId: string, input: UpdatePersonalCategoryInput) {
    const current = await this.db.category.findFirst({
      where: { id: categoryId, ownerUserId: userId },
      select: { id: true },
    });
    ensure(current, 404, 'CATEGORY_NOT_FOUND', 'Categoria no encontrada');
    try {
      return await this.db.category.update({
        where: { id: categoryId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.color !== undefined ? { color: input.color } : {}),
        },
        select: categoryView,
      });
    } catch (error) {
      throwDuplicate(error);
      throw error;
    }
  }

  async delete(userId: string, categoryId: string) {
    const result = await this.db.category.deleteMany({
      where: { id: categoryId, ownerUserId: userId },
    });
    ensure(result.count === 1, 404, 'CATEGORY_NOT_FOUND', 'Categoria no encontrada');
  }
}
