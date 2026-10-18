import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const main = await readFile(new URL('../main.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');

test('impulse titles follow observed events with a bottom fade and reduced-motion support', () => {
  assert.match(html, /id="impulse-feed"/);
  assert.match(html, /aria-label="Recent impulses"/);
  assert.match(main, /impulseFeed\.add\(kind, toolName, eventType, count\)/);
  assert.match(css, /mask-image: linear-gradient\(to bottom,/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test('live UI has no fabricated/demo activity controls or external dependency URL', () => {
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /data-mode|Calm|Storm|click a node/i);
  assert.doesNotMatch(main, /THOUGHTS|stimulate\(|setTimeout\(|\.modes|integrating stimulus/);
  assert.match(main, /createActivityClient/);
  assert.match(main, /state\.activeSessions/);
  assert.match(main, /QUIET · NOT VERIFIED IDLE/);
  assert.match(html, /open-session coverage not verifiable/i);
});

test('blue computation, orange steps, and accepted completion remain visually separate', () => {
  assert.match(main, /nodeEnergy/);
  assert.match(main, /nodeHot/);
  assert.match(main, /if \(blue > 0\)/);
  assert.match(main, /if \(orange > 0\)/);
  assert.match(main, /if \(completions > 0\) celebrateCompletion\(\)/);
  assert.match(main, /if \(!document.hidden\) impulseBuffer.add\(activity\)/);
  assert.match(main, /state.connection !== 'connected'\) impulseBuffer.clear\(\)/);
  assert.match(main, /'visibilitychange', \(\) => \{\s+impulseBuffer.clear\(\)/);
  assert.match(main, /celebrateCompletion/);
  assert.match(main, /maxPulses: 1600/);
  assert.match(main, /shocks\.length >= 8/);
});

test('blue running stream follows observed running work and discloses unverified lingering', () => {
  assert.match(html, /RUNNING <b id="running">/);
  assert.match(main, /Math\.min\(activityState\.runningSessions \?\? 0, 32\)/);
  assert.match(main, /!\(state\.runningSessions > 0\)\) thinkingPulseClock\.reset\(\)/);
  assert.match(main, /RUNNING · UNVERIFIED/);
  assert.match(main, /may linger if it ended without a recorded end/);
  assert.match(main, /'visibilitychange'[\s\S]*thinkingPulseClock\.reset\(\)/);
});

test('orbit and zoom controls remain enabled while canvas interactions do not create activity', () => {
  assert.match(main, /new OrbitControls/);
  assert.match(main, /controls\.enablePan = false/);
  assert.match(main, /controls\.minDistance/);
  assert.match(main, /controls\.maxDistance/);
  assert.doesNotMatch(main, /pointerdown|pointerup|stimulate\(/);
});
