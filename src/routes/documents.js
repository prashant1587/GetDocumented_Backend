const toPublicDocumentItem = (item, documentId) => ({
  id: item.id,
  title: item.title,
  description: item.description,
  mimeType: item.mimeType,
  fileName: item.fileName,
  position: item.position,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
  imageUrl: `/api/documents/${documentId}/items/${item.id}/image`
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

const normalizeItemInput = (item, index) => {
  if (!item?.title || !item?.description || !item?.screenshot) {
    return null;
  }

  const screenshot = parseScreenshotPayload(item.screenshot);

  if (!screenshot?.buffer?.length) {
    return null;
  }

  return {
    title: item.title,
    description: item.description,
    fileName: item.fileName || null,
    position: Number.isFinite(Number(item.position)) ? Number(item.position) : index,
    imageData: screenshot.buffer,
    mimeType: item.mimeType || screenshot.mimeType
  };
};

export default async function documentRoutes(fastify) {
  fastify.post('/documents', async (request, reply) => {
    const { title = null, items } = request.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return reply.code(400).send({ message: 'items array is required.' });
    }

    const normalizedItems = items
      .map((item, index) => normalizeItemInput(item, index))
      .filter(Boolean);

    if (normalizedItems.length !== items.length) {
      return reply.code(400).send({
        message: 'Every item must include title, description, and screenshot (base64 or data URL).'
      });
    }

    const document = await fastify.prisma.document.create({
      data: {
        title,
        items: {
          create: normalizedItems
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
    const { screenshot, mimeType, fileName } = request.body || {};

    const parsedScreenshot = parseScreenshotPayload(screenshot);

    if (!parsedScreenshot?.buffer?.length) {
      return reply.code(400).send({ message: 'screenshot is required and must be base64 or data URL.' });
    }

    const item = await fastify.prisma.documentItem.findUnique({ where: { id: request.params.itemId } });

    if (!item || item.documentId !== request.params.id) {
      return reply.code(404).send({ message: 'Document item not found.' });
    }

    const updated = await fastify.prisma.documentItem.update({
      where: { id: request.params.itemId },
      data: {
        imageData: parsedScreenshot.buffer,
        mimeType: mimeType || parsedScreenshot.mimeType || item.mimeType,
        fileName: fileName || item.fileName
      }
    });

    return toPublicDocumentItem(updated, request.params.id);
  });

  fastify.get('/documents/:id/items/:itemId/image', async (request, reply) => {
    const item = await fastify.prisma.documentItem.findUnique({
      where: { id: request.params.itemId },
      select: {
        imageData: true,
        mimeType: true,
        documentId: true
      }
    });

    if (!item || item.documentId !== request.params.id) {
      return reply.code(404).send({ message: 'Document item not found.' });
    }

    return reply.type(item.mimeType).send(Buffer.from(item.imageData));
  });
}
