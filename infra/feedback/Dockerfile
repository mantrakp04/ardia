FROM docker.io/library/node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797
WORKDIR /app
ENV NODE_ENV=production PORT=4319
COPY package.json server.mjs ./
COPY lib/ ./lib/
COPY core/ ./core/
RUN test -f core/anonymousIdentity.ts && test -f core/ingestKeys.ts
USER node
EXPOSE 4319
CMD ["node", "server.mjs"]
