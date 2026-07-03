#!/usr/bin/env node

/**
 * Post-sync script that adds the inlined LiveUpdatePlugin to the
 * Capacitor iOS project's packageClassList.
 *
 * cap sync only scans node_modules packages for @objc plugin classes;
 * it misses the inlined LiveUpdatePlugin.swift in the main app target.
 * This script re-adds it so the plugin is registered with the bridge.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(__dirname, '..', 'ios', 'App', 'App', 'capacitor.config.json');

try {
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));

  const classList = config.packageClassList ?? [];
  if (!classList.includes('LiveUpdatePlugin')) {
    classList.push('LiveUpdatePlugin');
    config.packageClassList = classList;
    writeFileSync(configPath, JSON.stringify(config, null, '\t') + '\n');
    console.log('[patch-capacitor-config] Added LiveUpdatePlugin to packageClassList');
  } else {
    console.log('[patch-capacitor-config] LiveUpdatePlugin already in packageClassList');
  }
} catch (err) {
  console.error('[patch-capacitor-config] Failed:', err.message);
  process.exit(1);
}