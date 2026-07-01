FROM oven/bun:1-alpine

WORKDIR /app

# Instala dependências usando o lockfile (cache de camada)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copia o código e compila
COPY . .
RUN bun run build

RUN mkdir -p logs && chown -R bun:bun /app

ENV NODE_ENV=production

# Container roda como usuário sem privilégios (imagem oven/bun já traz o user `bun`)
USER bun

CMD ["bun", "start"]
