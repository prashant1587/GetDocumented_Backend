import crypto from 'node:crypto';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { env } from '../config/env.js';

const sanitizeFilename = (value) => value.replace(/[^a-zA-Z0-9._-]/g, '_');

const extensionFromMimeType = (mimeType) => {
  if (!mimeType) {
    return 'bin';
  }

  const [, subtype = 'bin'] = mimeType.split('/');
  return subtype.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
};

const buildS3Key = ({ fileName, mimeType, folder = 'documents' }) => {
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const random = crypto.randomUUID();
  const extension = fileName?.includes('.')
    ? sanitizeFilename(fileName)
    : `${sanitizeFilename(fileName || `image.${extensionFromMimeType(mimeType)}`)}`;

  return `${folder}/${timestamp}-${random}-${extension}`;
};

const region = env.AWS_REGION;

export const s3Client = new S3Client({
  region,
  credentials:
    env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: env.AWS_ACCESS_KEY_ID,
          secretAccessKey: env.AWS_SECRET_ACCESS_KEY
        }
      : undefined
});

export const buildS3FileUrl = (key) => {
  if (env.S3_PUBLIC_BASE_URL) {
    return `${env.S3_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`;
  }

  return `https://${env.S3_BUCKET_NAME}.s3.${region}.amazonaws.com/${key}`;
};

export const uploadBufferToS3 = async ({ buffer, mimeType, fileName, folder }) => {
  const key = buildS3Key({ fileName, mimeType, folder });

  await s3Client.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: mimeType || 'application/octet-stream'
    })
  );

  return {
    key,
    url: buildS3FileUrl(key)
  };
};

export const createPresignedUpload = async ({ mimeType, fileName, folder = 'documents' }) => {
  const key = buildS3Key({ fileName, mimeType, folder });

  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET_NAME,
    Key: key,
    ContentType: mimeType || 'application/octet-stream'
  });

  const uploadUrl = await getSignedUrl(s3Client, command, {
    expiresIn: env.S3_PRESIGNED_URL_TTL_SECONDS
  });

  return {
    key,
    uploadUrl,
    fileUrl: buildS3FileUrl(key)
  };
};
