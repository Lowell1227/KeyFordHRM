# ── Stage 1: 构建 ──────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# 注入 API 地址（构建时通过 ARG 传入）
ARG VITE_API_BASE_URL
ARG VITE_DINGTALK_APP_KEY
ARG VITE_DINGTALK_CORP_ID
ARG VITE_DINGTALK_REDIRECT_URI
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_DINGTALK_APP_KEY=$VITE_DINGTALK_APP_KEY
ENV VITE_DINGTALK_CORP_ID=$VITE_DINGTALK_CORP_ID
ENV VITE_DINGTALK_REDIRECT_URI=$VITE_DINGTALK_REDIRECT_URI

FROM builder AS production-builder
RUN node ./scripts/validate-dingtalk-build-env.mjs && npm run build

# ── Stage 2: Nginx 静态文件服务 ──────────────────────
FROM nginx:1.25-alpine AS runner
COPY --from=production-builder /app/dist /usr/share/nginx/html
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
