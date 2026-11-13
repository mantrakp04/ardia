import { SECRETS, SEAWEEDFS_4_51, SERVICES } from "../shared";

export const deploymentGroupId = "feedback";

export const deploy = ({ secret, service }: any) => ({
  services: {
    [SERVICES.feedback]: {
      type: "server",
      minInstances: 1,
      memory: "512MB",
      ports: { 4319: { protocol: "tcp" } },
      dockerfilePath: "Dockerfile",
      env: {
        OBJECTS_HOST: service(SERVICES.feedbackObjects).hostname(),
        COLLECTOR_HOST: service(SERVICES.collector).hostname(),
        FEEDBACK_UPLOAD_SECRET: secret(SECRETS.feedbackUploadSecret),
        GITHUB_REPO: "ardia-browser/ardia",
        DASHBOARD_URL: "https://dash.ardia.dev",
        PUBLIC_URL: "https://ardia.dev",
      },
    },

    [SERVICES.feedbackObjects]: {
      type: "server",
      minInstances: 1,
      memory: "1GB",
      ports: { 8888: { protocol: "tcp" } },
      image: SEAWEEDFS_4_51,
      startCommand:
        "mkdir -p /data/weed && cd /data/weed && " +
        "exec weed server -dir=/data/weed -filer -master.volumePreallocate=false -master.volumeSizeLimitMB=512 -volume.max=18",
      persistentVolumes: { reports: { path: "/data", sizeGb: 10 } },
      env: {},
    },
  },
});
