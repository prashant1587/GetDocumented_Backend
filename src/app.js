import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

import { env, maxFileSizeInBytes } from './config/env.js';
import prismaPlugin from './plugins/prisma.js';
import screenshotRoutes from './routes/screenshots.js';
import documentRoutes from './routes/documents.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const swaggerSpecCandidates = [
  path.join(__dirname, '../docs/swagger.json'),
  path.join(process.cwd(), 'docs/swagger.json')
];

const resolveSwaggerDocument = () => {
  for (const candidate of swaggerSpecCandidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    try {
      const contents = fs.readFileSync(candidate, 'utf-8');
      return JSON.parse(contents);
    } catch {
      return null;
    }
  }

  return null;
};

export const buildApp = () => {
  const app = Fastify({ logger: true });
  const swaggerDocument = resolveSwaggerDocument();

  app.register(cors, {
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((item) => item.trim())
  });

  app.register(multipart, {
    limits: {
      fileSize: maxFileSizeInBytes,
      files: 1
    }
  });

  app.register(swagger, swaggerDocument ? {
    mode: 'dynamic',
    openapi: swaggerDocument
  } : {
    mode: 'dynamic',
    openapi: {
      info: {
        title: 'GetDocumented API',
        version: '1.0.0'
      }
    }
  });

  if (!swaggerDocument) {
    app.log.warn('Swagger specification file was not found or invalid. Falling back to minimal OpenAPI metadata.');
  }

  app.register(swaggerUi, {
    routePrefix: '/docs'
  });

  app.register(prismaPlugin);

  app.get('/health', async () => ({ status: 'ok' }));

  app.register(async (api) => {
    api.register(screenshotRoutes, { prefix: '/api' });
    api.register(documentRoutes, { prefix: '/api' });
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
