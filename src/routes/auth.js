import { createAuthToken, hashPassword, verifyPassword } from '../services/auth.js';
import { CAPABILITIES, ensureDefaultRoles, getRoleByKey, resolveRoleCapabilities, toPublicRole } from '../services/accessControl.js';
import { COMMON_DEPARTMENT_KEY, toPublicDepartment } from '../services/departments.js';

const toPublicUser = (user) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role ? toPublicRole(user.role) : null,
  departmentId: user.departmentId || null,
  department: user.department ? toPublicDepartment(user.department) : null,
  capabilities: resolveRoleCapabilities(user.role)
});

export default async function authRoutes(fastify) {
  fastify.get('/auth/users', { preHandler: fastify.requireCapability(CAPABILITIES.USERS_MANAGE) }, async () => {
    const users = await fastify.prisma.user.findMany({
      include: { role: true, department: true },
      orderBy: { createdAt: 'asc' }
    });

    return {
      users: users.map(toPublicUser)
    };
  });

  fastify.post('/auth/register', async (request, reply) => {
    const { name, email, password } = request.body || {};

    if (!name?.trim() || !email?.trim() || !password?.trim()) {
      return reply.code(400).send({ message: 'name, email, and password are required.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await fastify.prisma.user.findUnique({ where: { email: normalizedEmail } });
    const userCount = await fastify.prisma.user.count();

    let user;

    if (userCount === 0) {
      if (existing) {
        return reply.code(409).send({ message: 'A user with that email already exists.' });
      }

      const roles = await ensureDefaultRoles(fastify.prisma);
      const adminRole = roles.find((role) => role.key === 'admin');

      user = await fastify.prisma.user.create({
        data: {
          name: name.trim(),
          email: normalizedEmail,
          passwordHash: await hashPassword(password.trim()),
          roleId: adminRole?.id
        },
        include: { role: true, department: true }
      });
    } else {
      if (!existing) {
        return reply.code(403).send({ message: 'An admin must add your account before you can register.' });
      }

      if (existing.passwordHash) {
        return reply.code(409).send({ message: 'This account has already been registered. Please log in.' });
      }

      user = await fastify.prisma.user.update({
        where: { id: existing.id },
        data: {
          name: name.trim(),
          passwordHash: await hashPassword(password.trim())
        },
        include: { role: true, department: true }
      });
    }

    return reply.code(201).send({
      token: createAuthToken(user),
      user: toPublicUser(user)
    });
  });

  fastify.post('/auth/login', async (request, reply) => {
    const { email, password } = request.body || {};

    if (!email?.trim() || !password?.trim()) {
      return reply.code(400).send({ message: 'email and password are required.' });
    }

    const user = await fastify.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: { role: true, department: true }
    });

    if (user && !user.passwordHash) {
      return reply.code(403).send({ message: 'Your account has not been activated yet. Complete registration first.' });
    }

    if (!user || !(await verifyPassword(password.trim(), user.passwordHash))) {
      return reply.code(401).send({ message: 'Invalid email or password.' });
    }

    return {
      token: createAuthToken(user),
      user: toPublicUser(user)
    };
  });

  fastify.get('/auth/me', { preHandler: fastify.requireAuth }, async (request) => ({
    user: toPublicUser(request.authUser)
  }));

  fastify.get('/auth/roles', { preHandler: fastify.requireCapability(CAPABILITIES.ROLES_MANAGE) }, async () => {
    const roles = await fastify.prisma.role.findMany({
      orderBy: { createdAt: 'asc' }
    });

    return {
      capabilities: Object.values(CAPABILITIES),
      roles: roles.map(toPublicRole)
    };
  });

  fastify.post('/auth/users', { preHandler: fastify.requireCapability(CAPABILITIES.USERS_MANAGE) }, async (request, reply) => {
    const { name, email, password, departmentId } = request.body || {};

    if (!name?.trim() || !email?.trim()) {
      return reply.code(400).send({ message: 'name and email are required.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await fastify.prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (existing) {
      return reply.code(409).send({ message: 'A user with that email already exists.' });
    }

    let resolvedDepartmentId = null;

    if (departmentId) {
      const department = await fastify.prisma.department.findUnique({ where: { id: departmentId } });

      if (!department) {
        return reply.code(404).send({ message: 'Department not found.' });
      }

      if (department.key === COMMON_DEPARTMENT_KEY || department.isCommon) {
        return reply.code(400).send({ message: 'Users should not be assigned to the common department.' });
      }

      resolvedDepartmentId = department.id;
    }

    const editorRole = await getRoleByKey(fastify.prisma, 'editor');

    const user = await fastify.prisma.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        passwordHash: password?.trim() ? await hashPassword(password.trim()) : '',
        roleId: editorRole?.id,
        departmentId: resolvedDepartmentId
      },
      include: { role: true, department: true }
    });

    return reply.code(201).send({ user: toPublicUser(user) });
  });

  fastify.patch('/auth/users/:id', { preHandler: fastify.requireCapability(CAPABILITIES.USERS_MANAGE) }, async (request, reply) => {
    const { name, email, password, roleId } = request.body || {};
    const data = {};

    if (name?.trim()) {
      data.name = name.trim();
    }

    if (email?.trim()) {
      const normalizedEmail = email.trim().toLowerCase();
      const existing = await fastify.prisma.user.findUnique({ where: { email: normalizedEmail } });

      if (existing && existing.id !== request.params.id) {
        return reply.code(409).send({ message: 'A user with that email already exists.' });
      }

      data.email = normalizedEmail;
    }

    if (password?.trim()) {
      data.passwordHash = await hashPassword(password.trim());
    }

    if (roleId) {
      const role = await fastify.prisma.role.findUnique({ where: { id: roleId } });

      if (!role) {
        return reply.code(404).send({ message: 'Role not found.' });
      }

      data.roleId = roleId;
    }

    if (Object.prototype.hasOwnProperty.call(request.body || {}, 'departmentId')) {
      const { departmentId } = request.body || {};

      if (!departmentId) {
        data.departmentId = null;
      } else {
        const department = await fastify.prisma.department.findUnique({ where: { id: departmentId } });

        if (!department) {
          return reply.code(404).send({ message: 'Department not found.' });
        }

        if (department.key === COMMON_DEPARTMENT_KEY || department.isCommon) {
          return reply.code(400).send({ message: 'Users should not be assigned to the common department.' });
        }

        data.departmentId = department.id;
      }
    }

    if (!Object.keys(data).length) {
      return reply.code(400).send({ message: 'At least one field must be provided.' });
    }

    const existingUser = await fastify.prisma.user.findUnique({ where: { id: request.params.id } });

    if (!existingUser) {
      return reply.code(404).send({ message: 'User not found.' });
    }

    const user = await fastify.prisma.user.update({
      where: { id: request.params.id },
      data,
      include: { role: true, department: true }
    });

    return { user: toPublicUser(user) };
  });

  fastify.delete('/auth/users/:id', { preHandler: fastify.requireCapability(CAPABILITIES.USERS_MANAGE) }, async (request, reply) => {
    if (request.authUser?.id === request.params.id) {
      return reply.code(400).send({ message: 'You cannot delete your own account.' });
    }

    const existingUser = await fastify.prisma.user.findUnique({ where: { id: request.params.id } });

    if (!existingUser) {
      return reply.code(404).send({ message: 'User not found.' });
    }

    await fastify.prisma.user.delete({ where: { id: request.params.id } });
    return reply.code(204).send();
  });

  fastify.patch('/auth/roles/:id', { preHandler: fastify.requireCapability(CAPABILITIES.ROLES_MANAGE) }, async (request, reply) => {
    const { name, description, capabilities } = request.body || {};
    const role = await fastify.prisma.role.findUnique({ where: { id: request.params.id } });

    if (!role) {
      return reply.code(404).send({ message: 'Role not found.' });
    }

    if (!Array.isArray(capabilities) || capabilities.some((capability) => !Object.values(CAPABILITIES).includes(capability))) {
      return reply.code(400).send({ message: 'capabilities must be a valid capability array.' });
    }

    const updated = await fastify.prisma.role.update({
      where: { id: request.params.id },
      data: {
        name: name?.trim() || role.name,
        description: description?.trim() || '',
        capabilities
      }
    });

    return { role: toPublicRole(updated) };
  });
}
