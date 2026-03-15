import fp from 'fastify-plugin';

import { verifyAuthToken } from '../services/auth.js';
import { resolveRoleCapabilities } from '../services/accessControl.js';

const publicRoutePrefixes = ['/health', '/docs', '/api/auth'];
const authUserSelect = {
  id: true,
  email: true,
  name: true,
  departmentId: true,
  role: {
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      capabilities: true
    }
  },
  department: {
    select: {
      id: true,
      key: true,
      name: true,
      isCommon: true,
      createdAt: true,
      updatedAt: true
    }
  }
};

const isAdminUser = (user) => user?.role?.key === 'admin';

export default fp(async (fastify) => {
  fastify.decorateRequest('authUser', null);

  fastify.decorate('requireAuth', async (request, reply) => {
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
    const payload = verifyAuthToken(token);

    if (!payload) {
      return reply.code(401).send({ message: 'Authentication required.' });
    }

    const user = await fastify.prisma.user.findUnique({
      where: { id: payload.sub },
      select: authUserSelect
    });

    if (!user) {
      return reply.code(401).send({ message: 'Authentication required.' });
    }

    request.authUser = user;
  });

  fastify.decorate('requireCapability', (capability) => async (request, reply) => {
    const authResult = await fastify.requireAuth(request, reply);

    if (authResult || !request.authUser) {
      return authResult;
    }

    if (isAdminUser(request.authUser)) {
      return;
    }

    const capabilities = resolveRoleCapabilities(request.authUser.role);

    if (!capabilities.includes(capability)) {
      return reply.code(403).send({ message: 'You do not have permission to perform this action.' });
    }
  });

  fastify.addHook('onRequest', async (request) => {
    if (publicRoutePrefixes.some((prefix) => request.url.startsWith(prefix))) {
      return;
    }

    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
    const payload = verifyAuthToken(token);

    if (!payload) {
      return;
    }

    const user = await fastify.prisma.user.findUnique({
      where: { id: payload.sub },
      select: authUserSelect
    });

    if (user) {
      request.authUser = user;
    }
  });
});
