FROM nginx:1.27-alpine
ARG STAGING_VARIANT
LABEL org.cqrtv.environment="staging-only" org.cqrtv.variant="${STAGING_VARIANT}"
COPY index.html /usr/share/nginx/html/index.html
