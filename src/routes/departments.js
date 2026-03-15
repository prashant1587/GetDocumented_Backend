import { CAPABILITIES } from '../services/accessControl.js';
import { COMMON_DEPARTMENT_KEY, toPublicDepartment } from '../services/departments.js';

export default async function departmentRoutes(fastify) {
  fastify.get('/departments', { preHandler: fastify.requireAuth }, async (request) => {
    const departments = await fastify.prisma.department.findMany({
      orderBy: [{ isCommon: 'desc' }, { name: 'asc' }]
    });

    let visibleDepartments = departments;

    if (request.authUser?.role?.key !== 'admin' && request.authUser?.departmentId) {
      visibleDepartments = departments.filter(
        (department) =>
          department.isCommon ||
          department.key === COMMON_DEPARTMENT_KEY ||
          department.id === request.authUser.departmentId
      );
    }

    return {
      departments: visibleDepartments.map(toPublicDepartment)
    };
  });

  fastify.post('/departments', { preHandler: fastify.requireCapability(CAPABILITIES.DEPARTMENTS_MANAGE) }, async (request, reply) => {
    const { name } = request.body || {};

    if (!name?.trim()) {
      return reply.code(400).send({ message: 'name is required.' });
    }

    const normalizedName = name.trim();
    const key = normalizedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    if (!key || key === COMMON_DEPARTMENT_KEY) {
      return reply.code(400).send({ message: 'Provide a valid department name.' });
    }

    const existing = await fastify.prisma.department.findUnique({ where: { key } });

    if (existing) {
      return reply.code(409).send({ message: 'A department with that name already exists.' });
    }

    const department = await fastify.prisma.department.create({
      data: {
        key,
        name: normalizedName,
        isCommon: false
      }
    });

    return reply.code(201).send({ department: toPublicDepartment(department) });
  });

  fastify.patch('/departments/:id', { preHandler: fastify.requireCapability(CAPABILITIES.DEPARTMENTS_MANAGE) }, async (request, reply) => {
    const { name } = request.body || {};

    if (!name?.trim()) {
      return reply.code(400).send({ message: 'name is required.' });
    }

    const department = await fastify.prisma.department.findUnique({ where: { id: request.params.id } });

    if (!department) {
      return reply.code(404).send({ message: 'Department not found.' });
    }

    if (department.key === COMMON_DEPARTMENT_KEY || department.isCommon) {
      return reply.code(400).send({ message: 'The common department cannot be renamed.' });
    }

    const normalizedName = name.trim();
    const key = normalizedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const conflicting = await fastify.prisma.department.findUnique({ where: { key } });

    if (conflicting && conflicting.id !== department.id) {
      return reply.code(409).send({ message: 'A department with that name already exists.' });
    }

    const updated = await fastify.prisma.department.update({
      where: { id: department.id },
      data: {
        name: normalizedName,
        key
      }
    });

    return { department: toPublicDepartment(updated) };
  });

  fastify.delete('/departments/:id', { preHandler: fastify.requireCapability(CAPABILITIES.DEPARTMENTS_MANAGE) }, async (request, reply) => {
    const department = await fastify.prisma.department.findUnique({ where: { id: request.params.id } });

    if (!department) {
      return reply.code(404).send({ message: 'Department not found.' });
    }

    if (department.key === COMMON_DEPARTMENT_KEY || department.isCommon) {
      return reply.code(400).send({ message: 'The common department cannot be deleted.' });
    }

    const [userCount, documentCount] = await Promise.all([
      fastify.prisma.user.count({ where: { departmentId: department.id } }),
      fastify.prisma.document.count({ where: { departmentId: department.id } })
    ]);

    if (userCount > 0 || documentCount > 0) {
      return reply.code(400).send({ message: 'Move users and documents out of this department before deleting it.' });
    }

    await fastify.prisma.department.delete({ where: { id: department.id } });
    return reply.code(204).send();
  });
}
