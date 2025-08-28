# 多阶段构建的Dockerfile
FROM node:18-alpine AS base

# 安装bun
RUN npm install -g bun

WORKDIR /app

# 复制package文件
COPY package.json bun.lockb ./

# 安装依赖
RUN bun install --frozen-lockfile

# 开发阶段
FROM base AS development
COPY . .
EXPOSE 3000
CMD ["bun", "dev"]

# 构建阶段
FROM base AS build
COPY . .
RUN bun run build

# 生产阶段
FROM node:18-alpine AS production
RUN npm install -g bun
WORKDIR /app

# 只复制必要文件
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules

EXPOSE 3000
CMD ["bun", "start"]