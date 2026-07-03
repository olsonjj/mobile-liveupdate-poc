import { registerPlugin } from '@capacitor/core';
import type { LiveUpdatePluginPlugin } from './types';

const LiveUpdate = registerPlugin<LiveUpdatePluginPlugin>('LiveUpdate', {
  // No web fallback — this is a native-only plugin for the iOS POC.
  web: () => {
    throw new Error(
      'LiveUpdate plugin is not available on web. Run on iOS simulator.',
    );
  },
});

export default LiveUpdate;