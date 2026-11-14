FROM caddy:2-alpine AS site
COPY . /srv/
RUN rm -f /srv/Caddyfile

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=site /srv/ /srv/
