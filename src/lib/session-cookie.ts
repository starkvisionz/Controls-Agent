/**
 * Shared between the Node routes and the edge middleware, so it must stay free
 * of `node:` imports — the middleware runs on the edge runtime, which cannot
 * resolve them.
 */
export const SESSION_COOKIE = "starkvisionz_session";

/**
 * Token format tag. Bumped when the payload changes shape, so a cookie issued
 * by an older build is rejected rather than misread — `v1` carried no account
 * identity at all, and reading one as though it did would be worse than
 * refusing it.
 */
export const SESSION_TAG = "v2";

/** Sessions last a working day; a controls review does not outlive that. */
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
