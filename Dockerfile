FROM oven/bun:1-alpine

WORKDIR /app

# Instala dependências usando o lockfile (cache de camada)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copia o código e compila
COPY . .
RUN bun run build

RUN mkdir -p logs

ENV NODE_ENV=production

CMD ["bun", "start"]
