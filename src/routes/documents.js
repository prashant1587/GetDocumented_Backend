import { createPresignedUpload, uploadBufferToS3 } from '../services/s3Storage.js';

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

export default async function documentRoutes(fastify) {
  fastify.post('/documents/uploads/presigned-url', async (request, reply) => {
    const { mimeType, fileName } = request.body || {};

    const upload = await createPresignedUpload({
      mimeType: mimeType || 'application/octet-stream',
      fileName: fileName || 'document-screenshot'
    });

    return reply.code(201).send(upload);
  });

  fastify.post('/documents', async (request, reply) => {
    const { title = null, items } = request.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return reply.code(400).send({ message: 'items array is required.' });
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
        items: {
          create: validItems
        }
      },
      include: {
        items: true
      }
    });

    return reply.code(201).send(toPublicDocument(document));
  });

  fastify.get('/documents/:id', async (request, reply) => {
    const document = await fastify.prisma.document.findUnique({
      where: { id: request.params.id },
      include: { items: true }
    });

    if (!document) {
      return reply.code(404).send({ message: 'Document not found.' });
    }

    return toPublicDocument(document);
  });

  fastify.delete('/documents/:id', async (request, reply) => {
    const document = await fastify.prisma.document.findUnique({ where: { id: request.params.id } });

    if (!document) {
      return reply.code(404).send({ message: 'Document not found.' });
    }

    await fastify.prisma.document.delete({ where: { id: request.params.id } });
    return reply.code(204).send();
  });

  fastify.delete('/documents/:id/items/:itemId', async (request, reply) => {
    const item = await fastify.prisma.documentItem.findUnique({ where: { id: request.params.itemId } });

    if (!item || item.documentId !== request.params.id) {
      return reply.code(404).send({ message: 'Document item not found.' });
    }

    await fastify.prisma.documentItem.delete({ where: { id: request.params.itemId } });
    return reply.code(204).send();
  });

  fastify.patch('/documents/:id/items/:itemId/title', async (request, reply) => {
    const { title } = request.body || {};

    if (!title) {
      return reply.code(400).send({ message: 'title is required.' });
    }

    const item = await fastify.prisma.documentItem.findUnique({ where: { id: request.params.itemId } });

    if (!item || item.documentId !== request.params.id) {
      return reply.code(404).send({ message: 'Document item not found.' });
    }

    const updated = await fastify.prisma.documentItem.update({
      where: { id: request.params.itemId },
      data: { title }
    });

    return toPublicDocumentItem(updated, request.params.id);
  });

  fastify.patch('/documents/:id/items/:itemId/description', async (request, reply) => {
    const { description } = request.body || {};

    if (!description) {
      return reply.code(400).send({ message: 'description is required.' });
    }

    const item = await fastify.prisma.documentItem.findUnique({ where: { id: request.params.itemId } });

    if (!item || item.documentId !== request.params.id) {
      return reply.code(404).send({ message: 'Document item not found.' });
    }

    const updated = await fastify.prisma.documentItem.update({
      where: { id: request.params.itemId },
      data: { description }
    });

    return toPublicDocumentItem(updated, request.params.id);
  });

  fastify.patch('/documents/:id/items/:itemId/screenshot', async (request, reply) => {
    const { screenshot, screenshotUrl, mimeType, fileName } = request.body || {};

    const item = await fastify.prisma.documentItem.findUnique({ where: { id: request.params.itemId } });

    if (!item || item.documentId !== request.params.id) {
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

  fastify.get('/documents/:id/items/:itemId/image', async (request, reply) => {
    const item = await fastify.prisma.documentItem.findUnique({
      where: { id: request.params.itemId },
      select: {
        imageUrl: true,
        documentId: true
      }
    });

    if (!item || item.documentId !== request.params.id) {
      return reply.code(404).send({ message: 'Document item not found.' });
    }

    return reply.redirect(item.imageUrl);
  });
}
