import { SECRETS, SERVICES } from "../shared";

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
        OBJECTS_HOST: service(SERVICES.objects).hostname(),
        COLLECTOR_HOST: service(SERVICES.collector).hostname(),
        FEEDBACK_UPLOAD_SECRET: secret(SECRETS.feedbackUploadSecret),
        GITHUB_ISSUES_TOKEN: secret(SECRETS.feedbackGithubIssuesToken),
        GITHUB_REPO: "mantrakp04/ardia",
        DASHBOARD_URL: "https://dash.ardia.dev",
        PUBLIC_URL: "https://ardia.dev",
      },
    },
  },
});
