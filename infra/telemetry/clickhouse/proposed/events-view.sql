ALTER TABLE telemetry.otel_logs MODIFY COLUMN Timestamp DateTime64(9, 'UTC') CODEC(Delta(8), ZSTD(1));

ALTER TABLE telemetry.otel_logs
    ADD COLUMN IF NOT EXISTS ReplayFirstMs Int64 MATERIALIZED if(LogAttributes['event'] = '$replay_chunk', toInt64OrZero(LogAttributes['first_timestamp']), 0) CODEC(Delta(8), ZSTD(1)),
    ADD COLUMN IF NOT EXISTS ReplayLastMs Int64 MATERIALIZED if(LogAttributes['event'] = '$replay_chunk', toInt64OrZero(LogAttributes['last_timestamp']), 0) CODEC(Delta(8), ZSTD(1)),
    ADD COLUMN IF NOT EXISTS ReplayClicks UInt32 MATERIALIZED if(LogAttributes['event'] = '$replay_chunk', toUInt32OrZero(LogAttributes['clicks']), 0) CODEC(ZSTD(1)),
    ADD COLUMN IF NOT EXISTS ReplayBytes UInt64 MATERIALIZED if(LogAttributes['event'] = '$replay_chunk', toUInt64OrZero(LogAttributes['bytes']), 0) CODEC(ZSTD(1));

ALTER TABLE telemetry.otel_logs MATERIALIZE COLUMN ReplayFirstMs, MATERIALIZE COLUMN ReplayLastMs, MATERIALIZE COLUMN ReplayClicks, MATERIALIZE COLUMN ReplayBytes;

CREATE OR REPLACE VIEW telemetry.events AS
SELECT
    Uuid AS uuid,
    Event AS event,
    DistinctId AS distinct_id,
    SessionId AS session_id,
    Timestamp AS timestamp,
    CAST(LogAttributes, 'Map(String, String)') AS properties,
    LogAttributes['$elements_chain'] AS elements_chain,
    toString(ServiceName) AS source,
    toString(ServiceVersion) AS source_version,
    Lib AS lib,
    Host AS host,
    Os AS os,
    DeviceType AS device_type,
    Browser AS browser,
    AppVersion AS app_version,
    Version AS version,
    Pathname AS pathname,
    ReferringDomain AS referring_domain,
    Country AS country,
    ReplayFirstMs AS replay_first_ms,
    ReplayLastMs AS replay_last_ms,
    ReplayClicks AS replay_clicks,
    ReplayBytes AS replay_bytes
FROM telemetry.otel_logs FINAL
WHERE Event != ''
  AND ServiceName NOT IN ('ardia-selftest', 'netnyahoo-selftest')
  AND ServiceVersion != '0.0.0-selftest'
UNION ALL
SELECT
    uuid,
    toString(event) AS event,
    distinct_id,
    session_id,
    toDateTime64(timestamp, 9, 'UTC') AS timestamp,
    properties,
    elements_chain,
    'posthog-cloud' AS source,
    '' AS source_version,
    lib AS lib,
    host AS host,
    os AS os,
    device_type AS device_type,
    browser AS browser,
    app_version AS app_version,
    version AS version,
    pathname AS pathname,
    referring_domain AS referring_domain,
    country AS country,
    toInt64OrZero(properties['first_timestamp']) AS replay_first_ms,
    toInt64OrZero(properties['last_timestamp']) AS replay_last_ms,
    toUInt32OrZero(properties['clicks']) AS replay_clicks,
    toUInt64OrZero(properties['bytes']) AS replay_bytes
FROM telemetry.posthog_events;
