export const environment = {
  production: true,

  /**
   * Server base URL for the live-update manifest API.
   *
   * iOS 26+ simulators have their own network namespace,
   * so use the host Mac's LAN IP (e.g. 192.168.x.x), not localhost.
   */
  serverUrl: 'http://192.168.182.147:3000',
};
