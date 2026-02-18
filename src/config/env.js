import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1).default('file:./dev.db'),
  CORS_ORIGIN: z.string().default('*'),
  MAX_FILE_SIZE_MB: z.coerce.number().positive().default(10)
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const maxFileSizeInBytes = env.MAX_FILE_SIZE_MB * 1024 * 1024;
