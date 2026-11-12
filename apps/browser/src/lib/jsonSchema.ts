export type JsonType = "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";

export type JsonSchema = {
  type?: JsonType | JsonType[];
  enum?: readonly unknown[];
  const?: unknown;
  default?: unknown;
  description?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  pattern?: string;
  items?: JsonSchema | boolean;
  prefixItems?: JsonSchema[];
  minItems?: number;
  maxItems?: number;
  properties?: Record<string, JsonSchema>;
  additionalProperties?: JsonSchema | boolean;
  propertyNames?: JsonSchema;
  required?: string[];
  anyOf?: JsonSchema[];
};

export const JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";

export const schemaJson = (schema: object): string => `${JSON.stringify(schema, null, 2)}\n`;
