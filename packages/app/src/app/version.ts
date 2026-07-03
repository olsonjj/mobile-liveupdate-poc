/**
 * Current build version and greeting.
 *
 * Bump the build number and update the greeting when publishing a new payload.
 * This is the single source of truth for the currently bundled version.
 */
export const BUILD = {
  /** Monotonically increasing integer build number. */
  number: 1,
  /** Greeting displayed on screen to identify which bundle is active. */
  greeting: 'Hello Third First',
} as const;
