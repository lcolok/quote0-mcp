# 多阶段构建 - 构建阶段
FROM oven/bun:1 AS builder

WORKDIR /app

# 复制package.json
COPY package.json ./

# 安装依赖
RUN bun install

# 复制源代码
COPY . .

# 构建生产版本
RUN bun run build

# 生产阶段 - 使用nginx服务静态文件
FROM nginx:alpine

# 复制构建产物
COPY --from=builder /app/dist /usr/share/nginx/html

# 复制nginx配置
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 覆盖默认健康检查以避免IPv6回环问题
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1/ || exit 1

# 暴露端口
EXPOSE 80

# 启动nginx
CMD ["nginx", "-g", "daemon off;"]
