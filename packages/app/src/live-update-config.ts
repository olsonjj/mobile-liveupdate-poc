/**
 * Base URL of the local Fastify server's manifest endpoint (PRD "Server
 * package"). Plain HTTP on localhost — insecure by design, POC only.
 *
 * Centralised here so the cold-launch check (this slice) and the
 * foreground-resume trigger (issue 05) share a single source of truth.
 */
export const LIVE_UPDATE_SERVER_URL =
  'http://localhost:3000/api/updates/latest';
