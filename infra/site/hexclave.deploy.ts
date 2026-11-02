import { SECRETS, SERVICES } from "../shared";

export const deploymentGroupId = "site";

export const deploy = ({ secret, service }: any) => ({
  services: {
    site: {
      type: "serverless",
      public: true,
      ports: { 8080: { protocol: "http" } },
      dockerfilePath: "Dockerfile",
      minInstances: 1,
      maxInstances: 2,
      env: {
        TELEMETRY_COLLECTOR_HOST: service(SERVICES.collector).hostname(),
        TELEMETRY_CLICKHOUSE_HOST: service(SERVICES.clickhouse).hostname(),
        TELEMETRY_OBJECTS_HOST: service(SERVICES.objects).hostname(),
        TELEMETRY_REPLAYS_READ_TOKEN: secret(SECRETS.replaysReadToken),
      },
    },
  },
});
