import { GroupRole } from '@prisma/client';
import type { Database } from '../../database/client.js';
import { AppError, ensure } from '../../shared/errors.js';
import type { GroupsService } from '../groups/groups.service.js';
import type { CreateTagInput, UpdateTagInput } from './tags.schema.js';

const ALL_ROLES = [GroupRole.OWNER, GroupRole.ADMIN, GroupRole.MEMBER] as const;
const MANAGERS = [GroupRole.OWNER, GroupRole.ADMIN] as const;

const tagView = {
  id: true,
  groupId: true,
  ownerUserId: true,
  name: true,
} as const;

/** Etiquetas con alcance explícito: grupo o propietario personal, nunca ambos. */
export class TagsService {
  constructor(
    private readonly db: Database,
    private readonly groups: GroupsService,
  ) {}

  listPersonal(userId: string) {
    return this.db.tag.findMany({
      where: { ownerUserId: userId },
      select: tagView,
      orderBy: { name: 'asc' },
      take: 200,
    });
  }

  async createPersonal(userId: string, input: CreateTagInput) {
    try {
      return await this.db.tag.create({
        data: { ownerUserId: userId, name: input.name },
        select: tagView,
      });
    } catch (error) {
      if (error && typeof error === 'object' && (error as { code?: string }).code === 'P2002') {
        throw new AppError(409, 'TAG_EXISTS', 'Ya existe una etiqueta con ese nombre');
      }
      throw error;
    }
  }

  async deletePersonal(userId: string, tagId: string) {
    const result = await this.db.tag.deleteMany({ where: { id: tagId, ownerUserId: userId } });
    ensure(result.count === 1, 404, 'TAG_NOT_FOUND', 'Etiqueta no encontrada');
  }

  async updatePersonal(userId: string, tagId: string, input: UpdateTagInput) {
    const current = await this.db.tag.findFirst({
      where: { id: tagId, ownerUserId: userId },
      select: { id: true },
    });
    ensure(current, 404, 'TAG_NOT_FOUND', 'Etiqueta no encontrada');
    ensure(input.name, 422, 'TAG_NAME_REQUIRED', 'El nombre de la etiqueta es obligatorio');
    try {
      return await this.db.tag.update({
        where: { id: tagId },
        data: { name: input.name },
        select: tagView,
      });
    } catch (error) {
      if (error && typeof error === 'object' && (error as { code?: string }).code === 'P2002')
        throw new AppError(409, 'TAG_EXISTS', 'Ya existe una etiqueta con ese nombre');
      throw error;
    }
  }

  async listGroup(userId: string, groupId: string) {
    await this.groups.requireRole(userId, groupId, ALL_ROLES);
    return this.db.tag.findMany({
      where: { groupId },
      select: tagView,
      orderBy: { name: 'asc' },
      take: 200,
    });
  }

  async createGroup(userId: string, groupId: string, input: CreateTagInput) {
    await this.groups.requireRole(userId, groupId, MANAGERS);
    try {
      return await this.db.tag.create({
        data: { groupId, name: input.name },
        select: tagView,
      });
    } catch (error) {
      if (error && typeof error === 'object' && (error as { code?: string }).code === 'P2002') {
        throw new AppError(409, 'TAG_EXISTS', 'Ya existe una etiqueta con ese nombre');
      }
      throw error;
    }
  }

  async deleteGroup(userId: string, groupId: string, tagId: string) {
    await this.groups.requireRole(userId, groupId, MANAGERS);
    const result = await this.db.tag.deleteMany({ where: { id: tagId, groupId } });
    ensure(result.count === 1, 404, 'TAG_NOT_FOUND', 'Etiqueta no encontrada');
  }

  async updateGroup(userId: string, groupId: string, tagId: string, input: UpdateTagInput) {
    await this.groups.requireRole(userId, groupId, MANAGERS);
    const current = await this.db.tag.findFirst({
      where: { id: tagId, groupId },
      select: { id: true },
    });
    ensure(current, 404, 'TAG_NOT_FOUND', 'Etiqueta no encontrada');
    ensure(input.name, 422, 'TAG_NAME_REQUIRED', 'El nombre de la etiqueta es obligatorio');
    try {
      return await this.db.tag.update({
        where: { id: tagId },
        data: { name: input.name },
        select: tagView,
      });
    } catch (error) {
      if (error && typeof error === 'object' && (error as { code?: string }).code === 'P2002')
        throw new AppError(409, 'TAG_EXISTS', 'Ya existe una etiqueta con ese nombre');
      throw error;
    }
  }
}
