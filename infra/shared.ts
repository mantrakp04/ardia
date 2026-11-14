export const SERVICES = {
  clickhouse: "ph-clickhouse",
  objects: "ph-objects",
  collector: "otel-collector",
  feedback: "ardia-feedback",
  feedbackObjects: "ardia-feedback-objects",
} as const;

export const SEAWEEDFS_4_51 = "docker.io/chrislusf/seaweedfs@sha256:f7a49e3f3972ebed5be2ed4befa4a0c68eb7bdddba6e692d42729ceb545134b8";

export const SECRETS = {
  clickhouseAdmin: "TELEMETRY_CLICKHOUSE_ADMIN_PASSWORD",
  clickhouseOtel: "TELEMETRY_CLICKHOUSE_OTEL_PASSWORD",
  clickhouseReader: "TELEMETRY_CLICKHOUSE_READER_PASSWORD",
  replaysReadToken: "TELEMETRY_REPLAYS_READ_TOKEN",
  dashboardGithubToken: "DASHBOARD_GITHUB_TOKEN",
  feedbackUploadSecret: "FEEDBACK_UPLOAD_SECRET",
  feedbackGithubIssuesToken: "FEEDBACK_GITHUB_ISSUES_TOKEN",
} as const;

export const CLICKHOUSE_USERS = { reader: "reader", sandbox: "sandbox" } as const;
