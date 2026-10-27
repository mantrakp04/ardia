FROM docker.io/clickhouse/clickhouse-server@sha256:95f7cbf466dba734947775eb74808a13a3558e4398666ea6b1d992af85b9740d
COPY --chmod=0644 clickhouse/config.d/ardia.xml /etc/clickhouse-server/config.d/ardia.xml
COPY --chmod=0644 clickhouse/users.d/ardia.xml /etc/clickhouse-server/users.d/ardia.xml
COPY --chmod=0644 clickhouse/schema.sql /etc/ac/schema.sql
COPY --chmod=0644 clickhouse/replay_chunks.sql /etc/ac/replay_chunks.sql
COPY --chmod=0755 clickhouse/start.sh /usr/local/bin/ac-clickhouse
RUN chmod 0755 /etc/ac /etc/clickhouse-server/users.d
ENV CLICKHOUSE_SKIP_USER_SETUP=1
CMD ["/usr/local/bin/ac-clickhouse"]
ENTRYPOINT []
