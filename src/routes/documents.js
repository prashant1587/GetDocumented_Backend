import { buildExportFileName, buildWalkthroughPdf } from '../services/pdfExporter.js';
import { CAPABILITIES } from '../services/accessControl.js';
import {
  canUserAccessDocument,
  getCommonDepartment,
  toPublicDepartment
} from '../services/departments.js';
import {
  createPresignedUpload,
  downloadFileBufferFromS3,
  uploadBufferToS3
} from '../services/s3Storage.js';
import { getExportBrandingSettings } from './exportBranding.js';

const documentInclude = {
  items: true,
  department: true
};

const toPublicDocumentItem = (item, documentId) => ({
  id: item.id,
  title: item.title,
  description: item.description,
  mimeType: item.mimeType,
  fileName: item.fileName,
  position: item.position,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
  imageUrl: item.imageUrl,
  imageProxyUrl: `/api/documents/${documentId}/items/${item.id}/image`
});

const toPublicDocument = (document) => ({
  id: document.id,
  title: document.title,
  departmentId: document.departmentId || null,
  department: document.department ? toPublicDepartment(document.department) : null,
  creatorId: document.creatorId || null,
  createdAt: document.createdAt,
  updatedAt: document.updatedAt,
  items: document.items
    .sort((left, right) => left.position - right.position || left.createdAt - right.createdAt)
    .map((item) => toPublicDocumentItem(item, document.id))
});

const parseDataUri = (value) => {
  const matches = value.match(/^data:(.+);base64,(.+)$/);

  if (!matches) {
    return null;
  }

  return {
    mimeType: matches[1],
    buffer: Buffer.from(matches[2], 'base64')
  };
};

const parseScreenshotPayload = (value) => {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const parsedDataUri = parseDataUri(value);

  if (parsedDataUri) {
    return parsedDataUri;
  }

  return {
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(value, 'base64')
  };
};

const normalizeItemInput = async (item, index) => {
  if (!item?.title || !item?.description || (!item?.screenshot && !item?.screenshotUrl)) {
    return null;
  }

  if (item.screenshotUrl) {
    return {
      title: item.title,
      description: item.description,
      fileName: item.fileName || null,
      position: Number.isFinite(Number(item.position)) ? Number(item.position) : index,
      imageUrl: item.screenshotUrl,
      mimeType: item.mimeType || 'application/octet-stream'
    };
  }

  const screenshot = parseScreenshotPayload(item.screenshot);

  if (!screenshot?.buffer?.length) {
    return null;
  }

  const upload = await uploadBufferToS3({
    buffer: screenshot.buffer,
    fileName: item.fileName,
    mimeType: item.mimeType || screenshot.mimeType,
    folder: 'documents'
  });

  return {
    title: item.title,
    description: item.description,
    fileName: item.fileName || null,
    position: Number.isFinite(Number(item.position)) ? Number(item.position) : index,
    imageUrl: upload.url,
    mimeType: item.mimeType || screenshot.mimeType
  };
};

const getAccessibleDocument = async (prisma, user, documentId) => {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: documentInclude
  });

  if (!document || !canUserAccessDocument(user, document)) {
    return null;
  }

  return document;
};

const getAccessibleDocumentItem = async (prisma, user, documentId, itemId) => {
  const item = await prisma.documentItem.findUnique({
    where: { id: itemId },
    include: {
      document: {
        include: {
          department: true
        }
      }
    }
  });

  if (!item || item.documentId !== documentId || !canUserAccessDocument(user, item.document)) {
    return null;
  }

  return item;
};

const resolveDocumentDepartmentId = async (prisma, user, requestedDepartmentId) => {
  const commonDepartment = await getCommonDepartment(prisma);

  if (user.role?.key === 'admin') {
    if (!requestedDepartmentId) {
      return commonDepartment.id;
    }

    const department = await prisma.department.findUnique({ where: { id: requestedDepartmentId } });
    return department?.id || null;
  }

  if (user.departmentId) {
    if (requestedDepartmentId && requestedDepartmentId !== user.departmentId) {
      return false;
    }

    return user.departmentId;
  }

  if (!requestedDepartmentId) {
    return commonDepartment.id;
  }

  const department = await prisma.department.findUnique({ where: { id: requestedDepartmentId } });
  return department?.id || null;
};

export default async function documentRoutes(fastify) {
  fastify.get('/documents', { preHandler: fastify.requireCapability(CAPABILITIES.DOCUMENTS_READ) }, async (request) => {
    const documents = await fastify.prisma.document.findMany({
      include: documentInclude,
      orderBy: { createdAt: 'desc' }
    });

    return documents
      .filter((document) => canUserAccessDocument(request.authUser, document))
      .map(toPublicDocument);
  });

  fastify.post(
    '/documents/uploads/presigned-url',
    { preHandler: fastify.requireCapability(CAPABILITIES.DOCUMENTS_WRITE) },
    async (request, reply) => {
      const { mimeType, fileName } = request.body || {};

      try {
        const upload = await createPresignedUpload({
          mimeType: mimeType || 'application/octet-stream',
          fileName: fileName || 'document-screenshot'
        });

        return reply.code(201).send(upload);
      } catch (error) {
        request.log.error({ err: error }, 'Failed to create presigned S3 upload URL.');
        return reply.code(502).send({
          message:
            'Unable to create S3 upload URL. Configure AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, and S3_BUCKET_NAME for the backend container.'
        });
      }
    }
  );

  fastify.post('/documents', { preHandler: fastify.requireCapability(CAPABILITIES.DOCUMENTS_WRITE) }, async (request, reply) => {
    const { title = null, items, departmentId } = request.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return reply.code(400).send({ message: 'items array is required.' });
    }

    const resolvedDepartmentId = await resolveDocumentDepartmentId(
      fastify.prisma,
      request.authUser,
      departmentId || null
    );

    if (resolvedDepartmentId === false) {
      return reply.code(403).send({ message: 'You can only create documents for your allowed department.' });
    }

    if (!resolvedDepartmentId) {
      return reply.code(404).send({ message: 'Department not found.' });
    }

    let normalizedItems;

    try {
      normalizedItems = await Promise.all(items.map((item, index) => normalizeItemInput(item, index)));
    } catch (error) {
      request.log.error({ err: error }, 'Failed to upload screenshot(s) to S3 before document create.');
      return reply.code(502).send({ message: 'Failed to upload screenshot(s) to S3.' });
    }

    const validItems = normalizedItems.filter(Boolean);

    if (validItems.length !== items.length) {
      return reply.code(400).send({
        message:
          'Every item must include title, description, and either screenshot (base64/data URL) or screenshotUrl (already uploaded to S3).'
      });
    }

    const document = await fastify.prisma.document.create({
      data: {
        title,
        departmentId: resolvedDepartmentId,
        creatorId: request.authUser.id,
        items: {
          create: validItems
        }
      },
      include: documentInclude
    });

    return reply.code(201).send(toPublicDocument(document));
  });

  fastify.post('/documents/export/pdf', { preHandler: fastify.requireCapability(CAPABILITIES.DOCUMENTS_EXPORT) }, async (request, reply) => {
    const { title = 'GetDocumented Walkthrough', items } = request.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return reply.code(400).send({ message: 'items array is required.' });
    }

    let normalizedItems;

    try {
      normalizedItems = await Promise.all(items.map((item, index) => normalizeItemInput(item, index)));
    } catch (error) {
      request.log.error({ err: error }, 'Failed to prepare document export PDF input.');
      return reply.code(502).send({ message: 'Failed to prepare document export PDF input.' });
    }

    if (normalizedItems.length !== items.length) {
      return reply.code(400).send({
        message: 'Every item must include title, description, and screenshot (base64 or data URL).'
      });
    }

    const steps = await Promise.all(
      normalizedItems
        .sort((left, right) => left.position - right.position)
        .map(async (item) => ({
          title: item.title,
          description: item.description,
          imageData: await downloadFileBufferFromS3(item.imageUrl)
        }))
    );

    const pdfBuffer = await buildWalkthroughPdf({
      title,
      steps
    });

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', 'attachment; filename="getdocumented-walkthrough.pdf"');

    return reply.send(pdfBuffer);
  });

  fastify.get('/documents/:id', { preHandler: fastify.requireCapability(CAPABILITIES.DOCUMENTS_READ) }, async (request, reply) => {
    const document = await getAccessibleDocument(fastify.prisma, request.authUser, request.params.id);

    if (!document) {
      return reply.code(404).send({ message: 'Document not found.' });
    }

    return toPublicDocument(document);
  });

  fastify.get('/documents/:id/export/pdf', { preHandler: fastify.requireCapability(CAPABILITIES.DOCUMENTS_EXPORT) }, async (request, reply) => {
    const document = await getAccessibleDocument(fastify.prisma, request.authUser, request.params.id);

    if (!document) {
      return reply.code(404).send({ message: 'Document not found.' });
    }

    try {
      const branding = await getExportBrandingSettings(fastify.prisma);
      const sortedItems = [...document.items].sort(
        (left, right) => left.position - right.position || left.createdAt - right.createdAt
      );

      const steps = await Promise.all(
        sortedItems.map(async (item) => ({
          title: item.title,
          description: item.description,
          imageData: await downloadFileBufferFromS3(item.imageUrl)
        }))
      );

      const pdfBuffer = await buildWalkthroughPdf({
        title: document.title || `Document ${document.id}`,
        subtitle: 'No steps found.',
        steps,
        branding,
        metadata: {
          documentId: document.id,
          departmentName: document.department?.name || 'Common',
          createdAt: document.createdAt,
          updatedAt: document.updatedAt
        }
      });

      reply.header('Content-Type', 'application/pdf');
      reply.header(
        'Content-Disposition',
        `attachment; filename="${buildExportFileName({
          title: document.title,
          documentId: document.id,
          branding
        })}"`
      );

      return reply.send(pdfBuffer);
    } catch (error) {
      request.log.error({ err: error }, 'Failed to export document PDF.');
      return reply.code(502).send({ message: 'Unable to export document PDF.' });
    }
  });

  fastify.patch('/documents/:id/title', { preHandler: fastify.requireCapability(CAPABILITIES.DOCUMENTS_WRITE) }, async (request, reply) => {
    const { title } = request.body || {};

    if (typeof title !== 'string' || !title.trim()) {
      return reply.code(400).send({ message: 'title is required.' });
    }

    const document = await getAccessibleDocument(fastify.prisma, request.authUser, request.params.id);

    if (!document) {
      return reply.code(404).send({ message: 'Document not found.' });
    }

    const updated = await fastify.prisma.document.update({
      where: { id: request.params.id },
      data: { title: title.trim() },
      include: documentInclude
    });

    return toPublicDocument(updated);
  });

  fastify.delete('/documents/:id', { preHandler: fastify.requireCapability(CAPABILITIES.DOCUMENTS_WRITE) }, async (request, reply) => {
    const document = await getAccessibleDocument(fastify.prisma, request.authUser, request.params.id);

    if (!document) {
      return reply.code(404).send({ message: 'Document not found.' });
    }

    await fastify.prisma.document.delete({ where: { id: request.params.id } });
    return reply.code(204).send();
  });

  fastify.delete('/documents/:id/items/:itemId', { preHandler: fastify.requireCapability(CAPABILITIES.DOCUMENTS_WRITE) }, async (request, reply) => {
    const item = await getAccessibleDocumentItem(fastify.prisma, request.authUser, request.params.id, request.params.itemId);

    if (!item) {
      return reply.code(404).send({ message: 'Document item not found.' });
    }

    await fastify.prisma.documentItem.delete({ where: { id: request.params.itemId } });
    return reply.code(204).send();
  });

  fastify.patch('/documents/:id/items/:itemId/title', { preHandler: fastify.requireCapability(CAPABILITIES.DOCUMENTS_WRITE) }, async (request, reply) => {
    const { title } = request.body || {};

    if (!title?.trim()) {
      return reply.code(400).send({ message: 'title is required.' });
    }

    const item = await getAccessibleDocumentItem(fastify.prisma, request.authUser, request.params.id, request.params.itemId);

    if (!item) {
      return reply.code(404).send({ message: 'Document item not found.' });
    }

    const updated = await fastify.prisma.documentItem.update({
      where: { id: request.params.itemId },
      data: { title: title.trim() }
    });

    return toPublicDocumentItem(updated, request.params.id);
  });

  fastify.patch('/documents/:id/items/:itemId/description', { preHandler: fastify.requireCapability(CAPABILITIES.DOCUMENTS_WRITE) }, async (request, reply) => {
    const { description } = request.body || {};

    if (!description?.trim()) {
      return reply.code(400).send({ message: 'description is required.' });
    }

    const item = await getAccessibleDocumentItem(fastify.prisma, request.authUser, request.params.id, request.params.itemId);

    if (!item) {
      return reply.code(404).send({ message: 'Document item not found.' });
    }

    const updated = await fastify.prisma.documentItem.update({
      where: { id: request.params.itemId },
      data: { description: description.trim() }
    });

    return toPublicDocumentItem(updated, request.params.id);
  });

  fastify.patch('/documents/:id/items/:itemId/screenshot', { preHandler: fastify.requireCapability(CAPABILITIES.DOCUMENTS_WRITE) }, async (request, reply) => {
    const { screenshot, screenshotUrl, mimeType, fileName } = request.body || {};

    const item = await getAccessibleDocumentItem(fastify.prisma, request.authUser, request.params.id, request.params.itemId);

    if (!item) {
      return reply.code(404).send({ message: 'Document item not found.' });
    }

    let imageUrl = screenshotUrl;
    let resolvedMimeType = mimeType || item.mimeType;

    if (!imageUrl) {
      const parsedScreenshot = parseScreenshotPayload(screenshot);

      if (!parsedScreenshot?.buffer?.length) {
        return reply.code(400).send({
          message: 'Provide screenshotUrl or screenshot as a base64/data URL payload.'
        });
      }

      const upload = await uploadBufferToS3({
        buffer: parsedScreenshot.buffer,
        fileName,
        mimeType: mimeType || parsedScreenshot.mimeType,
        folder: 'documents'
      });

      imageUrl = upload.url;
      resolvedMimeType = mimeType || parsedScreenshot.mimeType || item.mimeType;
    }

    const updated = await fastify.prisma.documentItem.update({
      where: { id: request.params.itemId },
      data: {
        imageUrl,
        mimeType: resolvedMimeType,
        fileName: fileName || item.fileName
      }
    });

    return toPublicDocumentItem(updated, request.params.id);
  });

  fastify.get('/documents/:id/items/:itemId/image', { preHandler: fastify.requireCapability(CAPABILITIES.DOCUMENTS_READ) }, async (request, reply) => {
    const item = await getAccessibleDocumentItem(fastify.prisma, request.authUser, request.params.id, request.params.itemId);

    if (!item) {
      return reply.code(404).send({ message: 'Document item not found.' });
    }

    try {
      const imageBuffer = await downloadFileBufferFromS3(item.imageUrl);
      reply.header('Content-Type', item.mimeType || 'application/octet-stream');
      reply.header('Cache-Control', 'private, max-age=60');
      return reply.send(imageBuffer);
    } catch (error) {
      request.log.error({ err: error }, 'Failed to load document image from S3.');
      return reply.code(502).send({ message: 'Unable to load document image from S3.' });
    }
  });
}
