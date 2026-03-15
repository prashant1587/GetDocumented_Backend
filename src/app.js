import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

import { env, maxFileSizeInBytes, maxRequestBodyInBytes } from './config/env.js';
import authPlugin from './plugins/auth.js';
import prismaPlugin from './plugins/prisma.js';
import screenshotRoutes from './routes/screenshots.js';
import documentRoutes from './routes/documents.js';
import exportBrandingRoutes from './routes/exportBranding.js';
import authRoutes from './routes/auth.js';
import { ensureUserRoleAssignments } from './services/accessControl.js';
import { ensureDepartmentAssignments } from './services/departments.js';
import departmentRoutes from './routes/departments.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const swaggerSpecCandidates = [
  path.join(__dirname, '../docs/swagger.json'),
  path.join(process.cwd(), 'docs/swagger.json')
];

const loadSwaggerSpecification = () => {
  const swaggerSpecPath = swaggerSpecCandidates.find((candidate) => fs.existsSync(candidate));

  if (!swaggerSpecPath) {
    return null;
  }

  try {
    const swaggerDocument = JSON.parse(fs.readFileSync(swaggerSpecPath, 'utf8'));

    return { swaggerDocument, swaggerSpecPath };
  } catch (error) {
    return { swaggerDocument: null, swaggerSpecPath, error };
  }
};

export const buildApp = () => {
  const app = Fastify({ logger: true, bodyLimit: maxRequestBodyInBytes });
  const swaggerSpec = loadSwaggerSpecification();

  app.register(cors, {
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((item) => item.trim())
  });

  app.register(multipart, {
    limits: {
      fileSize: maxFileSizeInBytes,
      files: 20
    }
  });

  if (swaggerSpec?.swaggerDocument) {
    app.register(swagger, {
      openapi: swaggerSpec.swaggerDocument
    });
  } else {
    if (swaggerSpec?.error) {
      app.log.warn(
        { err: swaggerSpec.error, swaggerSpecPath: swaggerSpec.swaggerSpecPath },
        'Swagger specification file could not be loaded. Falling back to minimal OpenAPI metadata.'
      );
    } else {
      app.log.warn('Swagger specification file was not found. Falling back to minimal OpenAPI metadata.');
    }

    app.register(swagger, {
      openapi: {
        info: {
          title: 'GetDocumented API',
          version: '1.0.0'
        }
      }
    });
  }

  app.register(swaggerUi, {
    routePrefix: '/docs'
  });

  app.register(prismaPlugin);
  app.register(async (bootstrapApp) => {
    await ensureUserRoleAssignments(bootstrapApp.prisma);
    await ensureDepartmentAssignments(bootstrapApp.prisma);
  });
  app.register(authPlugin);

  app.get('/health', async () => ({ status: 'ok' }));

  app.register(async (api) => {
    api.register(authRoutes, { prefix: '/api' });
    api.register(departmentRoutes, { prefix: '/api' });
    api.register(screenshotRoutes, { prefix: '/api' });
    api.register(documentRoutes, { prefix: '/api' });
    api.register(exportBrandingRoutes, { prefix: '/api' });
  });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);

    if (error.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ message: `Uploaded file is too large. Maximum size is ${env.MAX_FILE_SIZE_MB}MB.` });
    }

    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.code(413).send({
        message: `Request payload is too large. Maximum body size is ${env.MAX_REQUEST_BODY_MB}MB. Use /api/documents/uploads/presigned-url for direct S3 uploads.`
      });
    }

    return reply.code(error.statusCode || 500).send({
      message: error.message || 'Internal server error'
    });
  });

  return app;
};
