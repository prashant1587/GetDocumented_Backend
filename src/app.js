import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

import { env, maxFileSizeInBytes } from './config/env.js';
import prismaPlugin from './plugins/prisma.js';
import screenshotRoutes from './routes/screenshots.js';

export const buildApp = () => {
  const app = Fastify({ logger: true });

  app.register(cors, {
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((item) => item.trim())
  });

  app.register(multipart, {
    limits: {
      fileSize: maxFileSizeInBytes,
      files: 1
    }
  });

  app.register(swagger, {
    openapi: {
      info: {
        title: 'GetDocumented Screenshots API',
        version: '1.0.0'
      }
    }
  });

  app.register(swaggerUi, {
    routePrefix: '/docs'
  });

  app.register(prismaPlugin);

  app.get('/health', async () => ({ status: 'ok' }));

  app.register(async (api) => {
    api.register(screenshotRoutes, { prefix: '/api' });
  });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);

    if (error.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ message: `Uploaded file is too large. Maximum size is ${env.MAX_FILE_SIZE_MB}MB.` });
    }

    return reply.code(error.statusCode || 500).send({
      message: error.message || 'Internal server error'
    });
  });

  return app;
};
