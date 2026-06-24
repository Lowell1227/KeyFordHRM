# ── Stage 1: 构建 ──────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Prisma 需要 OpenSSL 才能正确探测并下载匹配当前系统的引擎
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY . .
# 生成 Prisma Client
RUN npx prisma generate
# 编译 TypeScript
RUN npm run build

# ── Stage 2: 运行时（最小镜像）───────────────────────
FROM node:20-slim AS runner
WORKDIR /app

# 安装必要系统依赖（Prisma 需要 OpenSSL）
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# 非 root 用户运行
RUN groupadd -r appgroup && useradd -r -g appgroup appuser
USER appuser

COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/dist         ./dist
COPY --from=builder --chown=appuser:appgroup /app/prisma       ./prisma
# 运行 `prisma db seed` 需要 package.json(读取 prisma.seed)与 tsconfig(ts-node)
COPY --from=builder --chown=appuser:appgroup /app/package.json        ./package.json
COPY --from=builder --chown=appuser:appgroup /app/tsconfig.json       ./tsconfig.json
COPY --from=builder --chown=appuser:appgroup /app/tsconfig.build.json ./tsconfig.build.json

EXPOSE 3000

# 启动前执行数据库迁移，再启动应用
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
