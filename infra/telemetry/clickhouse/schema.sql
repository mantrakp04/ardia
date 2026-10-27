CREATE DATABASE IF NOT EXISTS telemetry;
CREATE DATABASE IF NOT EXISTS sandbox ENGINE = Atomic SETTINGS max_tables = 32;
ALTER DATABASE sandbox MODIFY SETTING max_tables = 32;

CREATE TABLE IF NOT EXISTS telemetry.otel_logs
(
    Timestamp DateTime64(9) CODEC(Delta(8), ZSTD(1)),
    TraceId String CODEC(ZSTD(1)),
    SpanId String CODEC(ZSTD(1)),
    TraceFlags UInt8,
    SeverityText LowCardinality(String) CODEC(ZSTD(1)),
    SeverityNumber UInt8,
    ServiceName LowCardinality(String) CODEC(ZSTD(1)),
    Body String CODEC(ZSTD(1)),
    ResourceSchemaUrl LowCardinality(String) CODEC(ZSTD(1)),
    ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    ScopeSchemaUrl LowCardinality(String) CODEC(ZSTD(1)),
    ScopeName String CODEC(ZSTD(1)),
    ScopeVersion LowCardinality(String) CODEC(ZSTD(1)),
    ScopeAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    LogAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    EventName String CODEC(ZSTD(1)),
    Event LowCardinality(String) MATERIALIZED LogAttributes['event'],
    Uuid String MATERIALIZED if(LogAttributes['uuid'] != '', LogAttributes['uuid'], toString(generateUUIDv4())),
    DistinctId String MATERIALIZED LogAttributes['distinct_id'],
    SessionId String MATERIALIZED LogAttributes['$session_id'],
    INDEX idx_session SessionId TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_distinct DistinctId TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(Timestamp)
ORDER BY (Event, toDate(Timestamp), Uuid)
TTL toDateTime(Timestamp) + INTERVAL 90 DAY DELETE WHERE Event = ''
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS telemetry.posthog_events
(
    uuid String,
    event LowCardinality(String),
    distinct_id String,
    timestamp DateTime64(6, 'UTC'),
    properties Map(String, String) CODEC(ZSTD(3)),
    elements_chain String CODEC(ZSTD(3)),
    person_id String,
    session_id String MATERIALIZED properties['$session_id']
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (event, toDate(timestamp), uuid);

ALTER TABLE telemetry.otel_logs MODIFY SETTING min_bytes_for_wide_part = 1073741824;
ALTER TABLE telemetry.posthog_events MODIFY SETTING min_bytes_for_wide_part = 1073741824;

ALTER TABLE telemetry.otel_logs
    ADD COLUMN IF NOT EXISTS ServiceVersion LowCardinality(String) MATERIALIZED ResourceAttributes['service.version'],
    ADD COLUMN IF NOT EXISTS Lib LowCardinality(String) MATERIALIZED LogAttributes['$lib'],
    ADD COLUMN IF NOT EXISTS Host LowCardinality(String) MATERIALIZED LogAttributes['$host'],
    ADD COLUMN IF NOT EXISTS Os LowCardinality(String) MATERIALIZED LogAttributes['$os'],
    ADD COLUMN IF NOT EXISTS DeviceType LowCardinality(String) MATERIALIZED LogAttributes['$device_type'],
    ADD COLUMN IF NOT EXISTS Browser LowCardinality(String) MATERIALIZED LogAttributes['$browser'],
    ADD COLUMN IF NOT EXISTS AppVersion LowCardinality(String) MATERIALIZED LogAttributes['$app_version'],
    ADD COLUMN IF NOT EXISTS Version LowCardinality(String) MATERIALIZED LogAttributes['version'],
    ADD COLUMN IF NOT EXISTS Pathname LowCardinality(String) MATERIALIZED LogAttributes['$pathname'],
    ADD COLUMN IF NOT EXISTS ReferringDomain LowCardinality(String) MATERIALIZED LogAttributes['$referring_domain'],
    ADD COLUMN IF NOT EXISTS Country LowCardinality(String) MATERIALIZED LogAttributes['$geoip_country_code'];

ALTER TABLE telemetry.posthog_events
    ADD COLUMN IF NOT EXISTS lib LowCardinality(String) MATERIALIZED properties['$lib'],
    ADD COLUMN IF NOT EXISTS host LowCardinality(String) MATERIALIZED properties['$host'],
    ADD COLUMN IF NOT EXISTS os LowCardinality(String) MATERIALIZED properties['$os'],
    ADD COLUMN IF NOT EXISTS device_type LowCardinality(String) MATERIALIZED properties['$device_type'],
    ADD COLUMN IF NOT EXISTS browser LowCardinality(String) MATERIALIZED properties['$browser'],
    ADD COLUMN IF NOT EXISTS app_version LowCardinality(String) MATERIALIZED properties['$app_version'],
    ADD COLUMN IF NOT EXISTS version LowCardinality(String) MATERIALIZED properties['version'],
    ADD COLUMN IF NOT EXISTS pathname LowCardinality(String) MATERIALIZED properties['$pathname'],
    ADD COLUMN IF NOT EXISTS referring_domain LowCardinality(String) MATERIALIZED properties['$referring_domain'],
    ADD COLUMN IF NOT EXISTS country LowCardinality(String) MATERIALIZED properties['$geoip_country_code'];

CREATE OR REPLACE VIEW telemetry.events AS
SELECT
    Uuid AS uuid,
    Event AS event,
    DistinctId AS distinct_id,
    SessionId AS session_id,
    toDateTime64(Timestamp, 6, 'UTC') AS timestamp,
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
    Country AS country
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
    timestamp,
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
    country AS country
FROM telemetry.posthog_events;

CREATE OR REPLACE VIEW telemetry.logs AS
SELECT
    toDateTime64(Timestamp, 6, 'UTC') AS timestamp,
    toString(ServiceName) AS source,
    ResourceAttributes['service.version'] AS source_version,
    SeverityText AS level,
    Body AS message,
    LogAttributes AS attributes
FROM telemetry.otel_logs
WHERE Event = '' AND ServiceName NOT IN ('ardia-selftest', 'netnyahoo-selftest') AND ResourceAttributes['service.version'] != '0.0.0-selftest';

CREATE OR REPLACE VIEW telemetry.replay_sessions AS
SELECT
    c.session_id AS session_id,
    c.distinct_id AS distinct_id,
    c.day AS day,
    c.start AS start,
    c.end AS end,
    dateDiff('second', c.start, c.end) AS duration_s,
    c.chunks AS chunks,
    c.bytes AS bytes,
    c.clicks AS clicks,
    e.pages AS pages,
    e.first_url AS first_url,
    e.device_type AS device_type,
    e.os AS os,
    e.browser AS browser,
    e.country AS country
FROM
(
    SELECT
        session_id,
        any(distinct_id) AS distinct_id,
        toDate(min(timestamp)) AS day,
        fromUnixTimestamp64Milli(min(toInt64OrZero(properties['first_timestamp']))) AS start,
        fromUnixTimestamp64Milli(max(toInt64OrZero(properties['last_timestamp']))) AS end,
        count() AS chunks,
        sum(toUInt64OrZero(properties['bytes'])) AS bytes,
        sum(toUInt64OrZero(properties['clicks'])) AS clicks
    FROM telemetry.events
    WHERE event = '$replay_chunk' AND session_id != ''
    GROUP BY session_id
) AS c
LEFT JOIN
(
    SELECT
        session_id,
        countIf(event = '$pageview') AS pages,
        argMinIf(properties['$current_url'], timestamp, event = '$pageview') AS first_url,
        any(properties['$device_type']) AS device_type,
        any(properties['$os']) AS os,
        any(properties['$browser']) AS browser,
        any(properties['$geoip_country_code']) AS country
    FROM telemetry.events
    WHERE session_id != '' AND event != '$replay_chunk'
    GROUP BY session_id
) AS e USING (session_id);
