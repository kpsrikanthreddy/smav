FROM node:22-slim

WORKDIR /app

# Install all dependencies (including vite & esbuild for production build)
COPY package.json package-lock.json ./
RUN npm ci

# Copy application source (secrets, .git, node_modules, Android builds, and artifacts are excluded via .dockerignore)
COPY . .

# Build frontend (dist/) and bundled backend (server.js)
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["npm", "run", "start"]
