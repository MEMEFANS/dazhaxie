# syntax=docker/dockerfile:1
# CaBi DApp 生产镜像：多阶段构建，最终只运行 standalone 产物，非 root。

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* 在 next build 时固化；改地址必须重新构建镜像。
ARG NEXT_PUBLIC_CHAIN_ID=56
ARG NEXT_PUBLIC_TRADING_MODE=pancake
ARG NEXT_PUBLIC_TOKEN_ADDRESS=
ARG NEXT_PUBLIC_GATEWAY_ADDRESS=
ARG NEXT_PUBLIC_USDT_ADDRESS=
ARG NEXT_PUBLIC_CLAIM_POOL_ADDRESS=
ARG NEXT_PUBLIC_REWARD_POOL_ADDRESS=
ARG NEXT_PUBLIC_SWAP_URL=
ARG NEXT_PUBLIC_RPC_URL=
ENV NEXT_PUBLIC_CHAIN_ID=$NEXT_PUBLIC_CHAIN_ID \
    NEXT_PUBLIC_TRADING_MODE=$NEXT_PUBLIC_TRADING_MODE \
    NEXT_PUBLIC_TOKEN_ADDRESS=$NEXT_PUBLIC_TOKEN_ADDRESS \
    NEXT_PUBLIC_GATEWAY_ADDRESS=$NEXT_PUBLIC_GATEWAY_ADDRESS \
    NEXT_PUBLIC_USDT_ADDRESS=$NEXT_PUBLIC_USDT_ADDRESS \
    NEXT_PUBLIC_CLAIM_POOL_ADDRESS=$NEXT_PUBLIC_CLAIM_POOL_ADDRESS \
    NEXT_PUBLIC_REWARD_POOL_ADDRESS=$NEXT_PUBLIC_REWARD_POOL_ADDRESS \
    NEXT_PUBLIC_SWAP_URL=$NEXT_PUBLIC_SWAP_URL \
    NEXT_PUBLIC_RPC_URL=$NEXT_PUBLIC_RPC_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    CABI_DATA_DIR=/data
# SQLite 数据目录必须挂载持久卷；容器内固定 /data，属主为 node。
RUN mkdir -p /data && chown node:node /data
# 关键运行时密钥（ADMIN_*、REDEMPTION_DATA_SECRET、APP_ORIGIN）通过 --env-file 注入，绝不写进镜像。
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
