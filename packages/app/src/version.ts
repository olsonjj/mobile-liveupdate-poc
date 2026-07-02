/**
 * The current build's identity.
 *
 * Bumped manually for each new payload (see PRD "Publish workflow"):
 *   1. Bump {@link VERSION} and change {@link GREETING} here.
 *   2. Run the Angular production build.
 *   3. Zip the output, copy into `packages/server/payloads/`.
 *   4. Rewrite the server's `manifest.json`.
 *
 * A successful live update is immediately visible on screen because the UI
 * renders both values from this constant.
 */
export const VERSION: number = 1;
export const GREETING: string = 'Hello World';
