import { CLICKHOUSE_USERS, SECRETS, SERVICES } from "../shared";

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
        CLICKHOUSE_HOST: service(SERVICES.clickhouse).hostname(),
        CLICKHOUSE_USER: CLICKHOUSE_USERS.reader,
        CLICKHOUSE_PASSWORD: secret(SECRETS.clickhouseReader),
        REPLAYS_HOST: service(SERVICES.objects).hostname(),
        DASHBOARD_ALLOWED_EMAILS: "mantrakp@gmail.com",
        GITHUB_TOKEN: secret(SECRETS.dashboardGithubToken),
        TRIAGE_CLICKHOUSE_USER: CLICKHOUSE_USERS.sandbox,
        TRIAGE_CLICKHOUSE_PASSWORD: secret(SECRETS.clickhouseAdmin),
      },
    },
  },
});
