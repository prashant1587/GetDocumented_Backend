import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1).default('mongodb://localhost:27017/getdocumented'),
  CORS_ORIGIN: z.string().default('*'),
  MAX_FILE_SIZE_MB: z.coerce.number().positive().default(10),
  MAX_REQUEST_BODY_MB: z.coerce.number().positive().default(50),
  AWS_REGION: z.string().min(1).default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  S3_BUCKET_NAME: z.string().min(1).default('get-documented-screenshots'),
  S3_PUBLIC_BASE_URL: z.string().url().optional(),
  S3_PRESIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900)
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const maxFileSizeInBytes = env.MAX_FILE_SIZE_MB * 1024 * 1024;
export const maxRequestBodyInBytes = env.MAX_REQUEST_BODY_MB * 1024 * 1024;
