import { buildScreenshotsPdf } from '../services/pdfExporter.js';

const parseMultipartRequest = async (request) => {
  const parts = request.parts();
  const payload = {};
  let imageFile = null;

  for await (const part of parts) {
    if (part.type === 'file') {
      if (part.fieldname === 'image') {
        const fileBuffer = await part.toBuffer();
        imageFile = {
          buffer: fileBuffer,
          mimeType: part.mimetype,
          filename: part.filename
        };
      }
      continue;
    }

    payload[part.fieldname] = part.value;
  }

  return { payload, imageFile };
};

const toPublicScreenshot = (screenshot) => ({
  id: screenshot.id,
  title: screenshot.title,
  description: screenshot.description,
  mimeType: screenshot.mimeType,
  fileName: screenshot.fileName,
  position: screenshot.position,
  createdAt: screenshot.createdAt,
  updatedAt: screenshot.updatedAt,
  imageUrl: `/api/screenshots/${screenshot.id}/image`
});

export default async function screenshotRoutes(fastify) {
  fastify.get('/screenshots', async () => {
    const screenshots = await fastify.prisma.screenshot.findMany({
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }]
    });

    return screenshots.map(toPublicScreenshot);
  });

  fastify.get('/screenshots/:id/image', async (request, reply) => {
    const screenshot = await fastify.prisma.screenshot.findUnique({
      where: { id: request.params.id },
      select: { imageData: true, mimeType: true }
    });

    if (!screenshot) {
      return reply.code(404).send({ message: 'Screenshot not found.' });
    }

    return reply.type(screenshot.mimeType).send(Buffer.from(screenshot.imageData));
  });

  fastify.post('/screenshots', async (request, reply) => {
    const { payload, imageFile } = await parseMultipartRequest(request);

    if (!payload.title || !payload.description) {
      return reply.code(400).send({ message: 'title and description are required.' });
    }

    if (!imageFile?.buffer?.length) {
      return reply.code(400).send({ message: 'image file is required.' });
    }

    const screenshot = await fastify.prisma.screenshot.create({
      data: {
        title: payload.title,
        description: payload.description,
        position: Number.isFinite(Number(payload.position)) ? Number(payload.position) : 0,
        imageData: imageFile.buffer,
        mimeType: imageFile.mimeType || 'application/octet-stream',
        fileName: imageFile.filename
      }
    });

    return reply.code(201).send(toPublicScreenshot(screenshot));
  });

  fastify.patch('/screenshots/:id', async (request, reply) => {
    const existing = await fastify.prisma.screenshot.findUnique({ where: { id: request.params.id } });

    if (!existing) {
      return reply.code(404).send({ message: 'Screenshot not found.' });
    }

    const isMultipart = request.isMultipart();

    let payload = request.body || {};
    let imageFile;

    if (isMultipart) {
      const parsed = await parseMultipartRequest(request);
      payload = parsed.payload;
      imageFile = parsed.imageFile;
    }

    const data = {};

    if (payload.title !== undefined) data.title = payload.title;
    if (payload.description !== undefined) data.description = payload.description;
    if (payload.position !== undefined && Number.isFinite(Number(payload.position))) {
      data.position = Number(payload.position);
    }

    if (imageFile?.buffer?.length) {
      data.imageData = imageFile.buffer;
      data.mimeType = imageFile.mimeType || existing.mimeType;
      data.fileName = imageFile.filename || existing.fileName;
    }

    const updated = await fastify.prisma.screenshot.update({
      where: { id: request.params.id },
      data
    });

    return toPublicScreenshot(updated);
  });

  fastify.delete('/screenshots/:id', async (request, reply) => {
    const existing = await fastify.prisma.screenshot.findUnique({ where: { id: request.params.id } });

    if (!existing) {
      return reply.code(404).send({ message: 'Screenshot not found.' });
    }

    await fastify.prisma.screenshot.delete({ where: { id: request.params.id } });
    return reply.code(204).send();
  });

  fastify.get('/screenshots/export/pdf', async (_request, reply) => {
    const screenshots = await fastify.prisma.screenshot.findMany({
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }]
    });

    const pdfBuffer = await buildScreenshotsPdf(screenshots);

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', 'attachment; filename="screenshots-export.pdf"');

    return reply.send(pdfBuffer);
  });
}
