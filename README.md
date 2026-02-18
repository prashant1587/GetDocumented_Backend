# GetDocumented Backend

Fastify backend for storing screenshot walkthrough steps (title, description, image bytes), editing and deleting them, and exporting the full list as a PDF.

## Features

- Create screenshot entries with title, description, optional position, and image upload.
- List screenshots in order.
- Update title/description/position and replace image.
- Delete screenshot entries.
- Stream screenshot image by ID.
- Export all screenshots to a downloadable PDF file.
- Swagger docs at `/docs`.

## Tech stack

- Fastify
- Prisma + SQLite
- PDFKit
- Multipart uploads via `@fastify/multipart`

## Setup

1. Copy env file:

   ```bash
   cp .env.example .env
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Initialize SQLite + Prisma (creates `dev.db` and applies migrations):

   ```bash
   npm run setup:sqlite
   ```

4. Start development server:

   ```bash
   npm run dev
   ```


## Run with Docker

### Docker Compose (recommended)

```bash
docker compose up --build
```

The API will be available at `http://localhost:3000`, Swagger docs at `http://localhost:3000/docs`, and SQLite data will be persisted in the named volume `screenshot_data`.

### Docker only

```bash
docker build -t getdocumented-backend .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL=file:/app/data/dev.db \
  -v getdocumented_data:/app/data \
  getdocumented-backend
```

On container startup, Prisma migrations are applied automatically with `prisma migrate deploy` before the server starts.

## SQLite setup details

- Default local DB path is `file:./dev.db` (auto-used when `DATABASE_URL` is not set).
- `npm run setup:sqlite` runs `prisma generate` then `prisma migrate deploy`.
- For local iterative schema work, you can still use `npm run prisma:migrate` (`prisma migrate dev`).

## Environment variables

- `PORT` (default: `3000`)
- `HOST` (default: `0.0.0.0`)
- `DATABASE_URL` (default in sample: `file:./dev.db`)
- `CORS_ORIGIN` (default: `*`, comma-separated values supported)
- `MAX_FILE_SIZE_MB` (default: `10`)

## API quick reference

Base path: `/api`

- `GET /screenshots` → list screenshots metadata.
- `GET /screenshots/:id/image` → download/render one screenshot image.
- `POST /screenshots` (multipart) → add screenshot.
  - fields: `title`, `description`, `position` (optional), `image` (file)
- `PATCH /screenshots/:id` (multipart or JSON) → update fields and optionally replace image.
- `DELETE /screenshots/:id` → delete screenshot.
- `GET /screenshots/export/pdf` → download full screenshots PDF.

## Notes for frontend integration

- Store only metadata from `GET /screenshots` and render each image using the returned `imageUrl`.
- Use `multipart/form-data` whenever uploading/replacing images.
- For batch insertion from a clickthrough flow, call `POST /screenshots` for each screenshot in order and set `position`.
