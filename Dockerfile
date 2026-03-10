FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATABASE_URL=mongodb://mongo:27017/getdocumented

COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src
COPY docs ./docs
COPY .env.example ./

EXPOSE 3000

CMD ["sh", "-c", "npx prisma db push && npm run start"]
