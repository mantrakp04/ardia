FROM docker.io/clickhouse/clickhouse-server:26.10.3@sha256:739e099abd1157390960a59e4532d21781d8fde57e6e4151cb920ea02c30b1ce
COPY --chmod=0644 clickhouse/config.d/ardia.xml /etc/clickhouse-server/config.d/ardia.xml
COPY --chmod=0644 clickhouse/users.d/ardia.xml /etc/clickhouse-server/users.d/ardia.xml
COPY --chmod=0644 clickhouse/schema.sql /etc/ac/schema.sql
COPY --chmod=0755 clickhouse/start.sh /usr/local/bin/ac-clickhouse
RUN chmod 0755 /etc/ac /etc/clickhouse-server/users.d
ENV CLICKHOUSE_SKIP_USER_SETUP=1
CMD ["/usr/local/bin/ac-clickhouse"]
ENTRYPOINT []
