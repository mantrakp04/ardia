import { readDocument } from "../../platform/documents";

export const SESSION_DOCUMENT = "session.json";

export const hasSavedSession = () => !!readDocument(SESSION_DOCUMENT);
