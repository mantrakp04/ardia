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
    toDateTime64(timestamp, 9) AS timestamp,
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
