export const deploymentGroupId = "posthog";

const SECRETS = {
  clickhouseAdmin: "TELEMETRY_CLICKHOUSE_ADMIN_PASSWORD",
  clickhouseOtel: "TELEMETRY_CLICKHOUSE_OTEL_PASSWORD",
  clickhouseReader: "TELEMETRY_CLICKHOUSE_READER_PASSWORD",
} as const;

const SEAWEEDFS_4_51 = "docker.io/chrislusf/seaweedfs@sha256:f7a49e3f3972ebed5be2ed4befa4a0c68eb7bdddba6e692d42729ceb545134b8";

export const deploy = ({ secret, service }: any) => ({
  services: {
    "ph-clickhouse": {
      type: "server",
      minInstances: 1,
      memory: "8GB",
      ports: { 8123: { protocol: "tcp" }, 9000: { protocol: "tcp" } },
      dockerfilePath: "clickhouse/Dockerfile",
      persistentVolumes: { chdata: { path: "/data", sizeGb: 20 } },
      env: {
        CLICKHOUSE_ADMIN_PASSWORD: secret(SECRETS.clickhouseAdmin),
        CLICKHOUSE_OTEL_PASSWORD: secret(SECRETS.clickhouseOtel),
        CLICKHOUSE_READER_PASSWORD: secret(SECRETS.clickhouseReader),
        CLICKHOUSE_SANDBOX_PASSWORD: secret(SECRETS.clickhouseAdmin),
      },
    },

    "otel-collector": {
      type: "server",
      minInstances: 1,
      memory: "512MB",
      ports: { 4318: { protocol: "tcp" }, 13133: { protocol: "tcp" } },
      dockerfilePath: "collector/Dockerfile",
      env: {
        CLICKHOUSE_HOST: service("ph-clickhouse").hostname(),
        CLICKHOUSE_OTEL_PASSWORD: secret(SECRETS.clickhouseOtel),
      },
    },

    "ph-objects": {
      type: "server",
      minInstances: 1,
      memory: "1GB",
      ports: { 8888: { protocol: "tcp" } },
      image: SEAWEEDFS_4_51,
      startCommand:
        "mkdir -p /data/weed && cd /data/weed && " +
        "{ (until echo 'fs.configure -locationPrefix=/buckets/replays/ -ttl=30d -apply' | weed shell -master=localhost:9333 2>/dev/null | grep -q replays; do sleep 3; done; echo '[ac] replays kept 30 days') & } && " +
        "exec weed server -dir=/data/weed -filer -master.volumePreallocate=false -volume.max=200",
      persistentVolumes: { objects: { path: "/data", sizeGb: 20 } },
      env: {},
    },
  },
});
