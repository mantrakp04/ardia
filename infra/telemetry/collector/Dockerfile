FROM docker.io/library/node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS geoip
COPY collector/fetch-geoip.mjs /fetch-geoip.mjs
RUN node /fetch-geoip.mjs 2026-10 1.0.18 c839d407f85a1e0bddba354cef16b2c398182d1c34ed8d985555dce134b36b14 /dbip-city-lite.mmdb \
 && test "$(stat -c %s /dbip-city-lite.mmdb)" -gt 1000000

FROM docker.io/otel/opentelemetry-collector-contrib:0.164.0@sha256:340c9ca6a36617084c6661bdc4f0fe92b7cda5a805d61673ec8db375fddc522b
COPY --from=geoip /dbip-city-lite.mmdb /etc/otelcol-contrib/dbip-city-lite.mmdb
COPY collector/config.yaml /etc/otelcol-contrib/config.yaml
