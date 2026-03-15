# GetDocumented Backend

Fastify backend for storing screenshot walkthrough steps, uploading document screenshots to S3, editing and deleting them, and exporting the full list as a PDF.

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
- Prisma + MongoDB
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

3. Initialize MongoDB schema + Prisma client:

   ```bash
   npm run setup:mongodb
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

The API will be available at `http://localhost:3000`, Swagger docs at `http://localhost:3000/docs`, and MongoDB data will be persisted in the named volume `mongo_data`.

### Docker only

```bash
docker build -t getdocumented-backend .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL=mongodb://host.docker.internal:27017/getdocumented \
  getdocumented-backend
```

On container startup, Prisma applies the schema to MongoDB automatically with `prisma db push` before the server starts.

## MongoDB setup details

- Default local DB URL is `mongodb://localhost:27017/getdocumented` (used when `DATABASE_URL` is not set).
- `npm run setup:mongodb` runs `prisma generate` then `prisma db push`.
- Use `npm run prisma:push` to apply schema changes.
- Use `npm run db:reset` to reset DB data while keeping schema in sync.

## Environment variables

- `PORT` (default: `3000`)
- `HOST` (default: `0.0.0.0`)
- `DATABASE_URL` (default: `mongodb://localhost:27017/getdocumented`)
- `CORS_ORIGIN` (default: `*`, comma-separated values supported)
- `MAX_FILE_SIZE_MB` (default: `10`)
- `MAX_REQUEST_BODY_MB` (default: `50`)
- `AWS_REGION` (default: `us-east-1`)
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `S3_BUCKET_NAME` (default: `get-documented-screenshots`)
- `S3_PUBLIC_BASE_URL` (optional public CDN/custom domain base URL)
- `S3_PRESIGNED_URL_TTL_SECONDS` (default: `900`)

## S3 setup

Direct document saves use pre-signed S3 uploads. The backend now fails at startup unless these values are configured in `.env` or Docker env:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`
- `S3_BUCKET_NAME`

Example:

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
S3_BUCKET_NAME=your-real-bucket-name
```

Your S3 bucket also needs CORS that allows browser `PUT` uploads. A minimal example is:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedOrigins": ["*"],
    "ExposeHeaders": ["ETag"]
  }
]
```

## API quick reference

Base path: `/api`

- `GET /screenshots` → list screenshots metadata.
- `GET /screenshots/:id/image` → download/render one screenshot image.
- `POST /screenshots` (multipart) → add screenshot.
  - fields: `title`, `description`, `position` (optional), `image` (file)
- `PATCH /screenshots/:id` (multipart or JSON) → update fields and optionally replace image.
- `DELETE /screenshots/:id` → delete screenshot.
- `GET /screenshots/export/pdf` → download full screenshots PDF.

- `POST /documents/uploads/presigned-url` (JSON) → get pre-signed S3 upload URL for direct client upload (recommended to avoid 413).
  - body: `{ "mimeType"?: string, "fileName"?: string }`
- `POST /documents` (JSON) → create one document with multiple items.
  - body: `{ "title"?: string, "items": [{ "title": string, "description": string, "screenshot"?: string(base64|dataURL), "screenshotUrl"?: string, "mimeType"?: string, "fileName"?: string, "position"?: number }] }`
  - API uploads base64 screenshots to S3 first, then stores only the image URL in MongoDB.
- `GET /documents/:id` → fetch one document with all items.
- `DELETE /documents/:id` → delete one document (and all items).
- `DELETE /documents/:id/items/:itemId` → delete one item from a document.
- `PATCH /documents/:id/items/:itemId/title` → update item title.
- `PATCH /documents/:id/items/:itemId/description` → update item description.
- `PATCH /documents/:id/items/:itemId/screenshot` → replace one item screenshot using either `screenshotUrl` or base64/dataURL payload.
- `GET /documents/:id/items/:itemId/image` → redirects to the stored S3 URL.

## Notes for frontend integration

- Store only metadata from `GET /screenshots` and render each image using the returned `imageUrl`.
- For document items, upload screenshots directly to S3 with `POST /documents/uploads/presigned-url`, then send `screenshotUrl` to `POST /documents` to avoid large JSON payloads (413).
- Use `multipart/form-data` whenever uploading/replacing images on `/screenshots` endpoints.
- For batch insertion from a clickthrough flow, call `POST /screenshots` for each screenshot in order and set `position`.
