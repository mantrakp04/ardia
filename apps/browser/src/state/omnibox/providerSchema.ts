import { PROVIDER_CONFIG_LIMITS, PROVIDER_LIMITS, QUERY_SLOT } from "@ardia/core";
import type { JsonSchema } from "../../lib/jsonSchema";

const WEB_URL = "^https?://[^\\s/?#@]+([/?#]\\S*)?$";
const QUERY_URL = `^https?://\\S*\\{query\\}\\S*$`;

const ROW: JsonSchema = {
  type: "object",
  properties: {
    title: { type: "string", description: "What the row says" },
    url: { type: "string", pattern: WEB_URL, description: "Where it goes: an http or https URL" },
    subtitle: { type: "string" },
    icon: { type: ["string", "null"], description: "An https URL or a small data:image (png, jpeg, gif, webp, ico)" },
  },
  required: ["title", "url"],
  additionalProperties: false,
};

export const PROVIDERS_SCHEMA: JsonSchema = {
  type: "array",
  maxItems: PROVIDER_CONFIG_LIMITS.providers,
  description:
    `Address bar providers. With a keyword, typing it then Space or Tab enters that provider; without one, its rows join the list (global). ` +
    `rows: a static list. url: a template, ${QUERY_SLOT} is what you type. suggest: an https endpoint answering OpenSearch suggestions or [{title, url}]. ` +
    `A suggest endpoint or a global provider only runs once approved in Ardia.`,
  items: {
    type: "object",
    properties: {
      keyword: { type: "string", pattern: "^[^\\s/?#:@.!]{1,32}$" },
      title: { type: "string", description: `Shown on the chip and on each row, up to ${PROVIDER_LIMITS.providerTitle} characters` },
      global: { type: "boolean", description: "No keyword: the rows join the normal list. Needed for a suggest endpoint without a keyword" },
      rows: { type: "array", items: ROW, maxItems: PROVIDER_CONFIG_LIMITS.rows },
      url: { type: "string", pattern: QUERY_URL, description: `A link template with ${QUERY_SLOT}; needs a keyword` },
      suggest: { type: "string", pattern: QUERY_URL, description: `An https suggestion endpoint with ${QUERY_SLOT}` },
    },
    additionalProperties: false,
  },
};
