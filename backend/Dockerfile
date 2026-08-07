FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY dist ./dist
COPY *.json ./

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
