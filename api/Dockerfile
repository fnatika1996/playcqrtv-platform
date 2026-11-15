FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.mjs password-policy.mjs admin-routes.mjs site-control.mjs ./
COPY migrations ./migrations
COPY scripts ./scripts
USER node
EXPOSE 3000
CMD ["node","server.mjs"]

