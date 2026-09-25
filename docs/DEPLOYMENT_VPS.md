# VPS deployment (foundation)

Phase 1 provides the container setup; hardening, backups and the release
process are completed in Phase 15.

```
Internet ─► nginx :80/:443 (TLS, rate limit) ─► api :3001 ─► mysql :3306
                         edge network              backend network (internal, no published port)
```

## First start

1. A Linux VPS with Docker Engine and the Compose plugin; DNS `A` record for
   the API domain pointing at it; firewall open only for 22, 80, 443.
2. Copy the repository, then `cp docker/.env.example docker/.env`,
   `chmod 600 docker/.env`, and fill it in (`openssl rand -hex 32` for each
   password and secret — hex keeps them safe inside the database URL).
3. First TLS certificate (port 80 must be free):
   ```bash
   docker run --rm -p 80:80 -v ipt-pm_letsencrypt:/etc/letsencrypt certbot/certbot \
     certonly --standalone -d "$API_DOMAIN" --agree-tos -m you@example.com --non-interactive
   ```
4. Start: `docker compose --env-file docker/.env -f docker/docker-compose.yml up -d --build`.
   The `migrate` job applies database migrations before the API starts.
5. Check: `curl https://$API_DOMAIN/api/v1/health/ready`.

The `certbot` service renews the certificate; reload nginx after a renewal
(`docker compose exec nginx nginx -s reload`) — automated in Phase 15.

## What protects what

- MySQL has **no published port** and sits on an internal network; only the
  API container can reach it.
- The API container runs as an unprivileged user with a read-only root
  filesystem; uploaded files live in the `storage` volume.
- nginx terminates TLS (TLS 1.2/1.3, HSTS), rate-limits per IP, sets its own
  request ID (passed to the API logs) and exposes only `/api/`.
