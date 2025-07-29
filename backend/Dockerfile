FROM node:22-slim AS builder

WORKDIR /app

COPY ./package*.json ./
COPY ./pnpm-*.yaml ./

RUN  npm i -g pnpm
RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm build

FROM node:22-slim AS Production

WORKDIR /app

COPY ./package*.json ./
COPY ./pnpm-*.yaml ./

RUN npm i -g pnpm
RUN pnpm i 

COPY --from=builder /app .

EXPOSE 8000

CMD ["pnpm","start"]




