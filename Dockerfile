# Stage 1: install deps and build (npm prepare runs the build during npm ci)
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json tsconfig*.json ./
COPY src ./src
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: minimal runtime image
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist
COPY README.md LICENSE ./
ENTRYPOINT ["node", "dist/bin/firebase-dump.js"]
