FROM node:22-alpine
ARG STAGING_VARIANT
LABEL org.cqrtv.environment="staging-only" org.cqrtv.variant="${STAGING_VARIANT}"
WORKDIR /app
COPY server.mjs ./server.mjs
EXPOSE 3000
USER node
CMD ["node", "server.mjs"]
