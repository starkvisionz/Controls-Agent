/**
 * Shared between the Node routes and the edge middleware, so it must stay free
 * of `node:` imports — the middleware runs on the edge runtime, which cannot
 * resolve them.
 */
export const SESSION_COOKIE = "hermes_session";

/** Sessions last a working day; a controls review does not outlive that. */
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
