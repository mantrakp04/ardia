export const deploymentGroupId = "dashboard";

export const deploy = ({ secret, service, hexclave }: any) => ({
  services: {
    dashboard: {
      type: "serverless",
      public: true,
      ports: { 3000: { protocol: "http" } },
      dockerfilePath: "Dockerfile",
      minInstances: 1,
      maxInstances: 1,
      env: {
        HEXCLAVE_PROJECT_ID: hexclave.projectId,
        HEXCLAVE_SECRET_SERVER_KEY: hexclave.secretServerKey,
        CLICKHOUSE_HOST: service("ph-clickhouse").hostname(),
        CLICKHOUSE_USER: "reader",
        CLICKHOUSE_PASSWORD: secret("TELEMETRY_CLICKHOUSE_READER_PASSWORD"),
        REPLAYS_HOST: service("ph-objects").hostname(),
        DASHBOARD_ALLOWED_EMAILS: "mantrakp@gmail.com",
        GITHUB_TOKEN: secret("DASHBOARD_GITHUB_TOKEN"),
        TRIAGE_CLICKHOUSE_USER: "sandbox",
        TRIAGE_CLICKHOUSE_PASSWORD: secret("DASHBOARD_TRIAGE_CLICKHOUSE_PASSWORD", ""),
      },
    },
  },
});
