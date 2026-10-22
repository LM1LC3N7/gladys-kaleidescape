// -----------------------------------------------------------------------------
// KaleidescapeApp with the SDK's fake Gladys, the exact handlers of the
// container (src/handlers.js), a memory store and the fake player on the
// loopback interface. The tick timer never fires: the tests drive the reads.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { KaleidescapeApp } from '../src/app.js';
import { TIMINGS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { MemoryStore } from '../src/store.js';
import { SERIAL_ID, startFakePlayer } from './fixtures/fakePlayer.js';

const SELECTOR = 'kaleidescape';
const id = (key, serial = SERIAL_ID) => `ext:${SELECTOR}:player:${serial}${key ? `:${key}` : ''}`;

/** No tick timer; real (short) timeouts. */
const timers = {
  setInterval: () => 1,
  clearInterval: () => {},
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
};

const FAST = {
  ...TIMINGS,
  connectTimeout: 300,
  readTimeout: 300,
  commandBudget: 900,
  preRead: 300,
  writeMargin: 50,
  confirmStep: 30,
  pollBudget: 1_500,
  persistDelay: 5,
};

async function waitFor(predicate, what, timeout = 3_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`timed out waiting for ${what}`);
}

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

async function setup(t, { fakeOptions, config, timings = {}, store = new MemoryStore() } = {}) {
  const fake = await startFakePlayer(fakeOptions);
  t.after(() => fake.close());
  const gladys = createFakeGladys({
    selector: SELECTOR,
    config: config ?? { addresses: `127.0.0.1:${fake.port}` },
  });
  const logs = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(`${level} ${args.map((a) => a?.message ?? a).join(' ')}`),
    ]),
  );
  const app = new KaleidescapeApp({
    gladys,
    logger,
    store,
    timers,
    timings: { ...FAST, ...timings },
  });
  registerHandlers(gladys, app, logger);
  t.after(() => app.stop());
  await gladys.connect();
  return { fake, gladys, app, logs, store };
}

async function discovered(gladys, serial = SERIAL_ID) {
  await waitFor(
    () => gladys.fake.discoveredDevices.some((d) => d.external_id === id(undefined, serial)),
    'the player in the Discovery tab',
  );
  return gladys.fake.discoveredDevices.find((d) => d.external_id === id(undefined, serial));
}

async function createDevice(gladys) {
  const device = await discovered(gladys);
  await gladys.fake.deviceCreated(device);
  await waitFor(() => gladys.fake.lastState(id('power')) !== undefined, 'the power state');
  return device;
}

const press = (gladys, device, key, value = 1) =>
  gladys.fake.setValue(
    device,
    device.features.find((f) => f.external_id === id(key)),
    value,
  );

/** The next read of every address is due now (the tests do not wait 15 s). */
async function readNow(app) {
  for (const link of app.links.values()) {
    link.lastAttempt = -Infinity;
  }
  await app.tick();
}

test('a typed address becomes a Gladys device, identified by its serial number', async (t) => {
  const { gladys, fake, store } = await setup(t, {
    fakeOptions: { power: '1', play: '2', chatty: true },
  });
  const device = await discovered(gladys);
  assert.equal(device.name, 'Kaleidescape Théâtre');
  assert.deepEqual(device.params, [
    { name: 'IP_ADDRESS', value: '127.0.0.1' },
    { name: 'MODEL', value: 'Strato S' },
  ]);
  const keys = device.features.map((f) => f.external_id.slice(id().length + 1));
  assert.deepEqual(keys, [
    'power',
    'power_status',
    'power_on',
    'standby',
    'play',
    'pause',
    'stop',
    'remote_key',
    'playing',
    'play_status',
    'title',
    'chapter',
    'movie_location',
    'video_mode',
    'dynamic_range',
  ]);
  // No switch, nothing an "everything on / off" could command.
  assert.ok(device.features.every((f) => f.category !== 'switch'));
  const byKey = Object.fromEntries(device.features.map((f) => [f.external_id.split(':').pop(), f]));
  for (const key of ['power_on', 'standby', 'play', 'pause', 'stop']) {
    assert.deepEqual([byKey[key].category, byKey[key].type], ['button', 'push'], key);
  }
  assert.deepEqual(
    [byKey.power.category, byKey.power.type, byKey.power.read_only],
    ['unknown', 'binary', true],
  );
  assert.ok(
    device.features.every((f) => f.unit === undefined),
    'no unit',
  );
  assert.equal(gladys.fake.states.length, 0, 'no state before the device is created');

  await createDevice(gladys);
  await waitFor(() => gladys.fake.lastState(id('title')) !== undefined, 'the title');
  assert.equal(gladys.fake.lastState(id('power')), 1);
  assert.equal(gladys.fake.lastState(id('power_status')), 'On');
  assert.equal(gladys.fake.lastState(id('playing')), 1);
  assert.equal(gladys.fake.lastState(id('play_status')), 'Playing');
  assert.equal(gladys.fake.lastState(id('title')), 'Turtle Odyssey: Part 2');
  assert.equal(gladys.fake.lastState(id('chapter')), 3);
  assert.equal(gladys.fake.lastState(id('movie_location')), 'Content');
  assert.equal(gladys.fake.lastState(id('video_mode')), '3840x2160p24 16:9');
  assert.equal(gladys.fake.lastState(id('dynamic_range')), 'HDR10 (PQ)');
  assert.equal(fake.commands().length, 0, 'reading never sends a command');
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
  // /data: the player and the time of the read, nothing of what plays.
  await settle(30);
  const saved = JSON.stringify(store.data);
  assert.ok(saved.includes(SERIAL_ID));
  assert.ok(!saved.includes('Turtle'));
});

test('in standby: power 0, nothing plays, no playback read', async (t) => {
  const { gladys, fake } = await setup(t);
  await createDevice(gladys);
  await waitFor(() => gladys.fake.lastState(id('title')) !== undefined, 'the states');
  assert.equal(gladys.fake.lastState(id('power')), 0);
  assert.equal(gladys.fake.lastState(id('power_status')), 'Standby');
  assert.equal(gladys.fake.lastState(id('playing')), 0);
  assert.equal(gladys.fake.lastState(id('title')), 'No title');
  assert.equal(gladys.fake.lastState(id('chapter')), 0);
  assert.ok(!fake.received.includes('GET_PLAY_STATUS'));
});

test('reads are never sooner than the interval: ticks, connections, check button, restarts', async (t) => {
  const store = new MemoryStore();
  const { gladys, fake, app } = await setup(t, { store });
  await createDevice(gladys);
  await settle(50);
  const connections = fake.connections;
  await app.tick();
  await app.start(await gladys.getConfig(), { connected: true });
  await app.start(await gladys.getConfig(), { saved: true });
  const check = await app.checkPlayers();
  await settle(50);
  assert.equal(fake.connections, connections, 'nothing read again');
  assert.match(check.en, /Kaleidescape Théâtre \(127\.0\.0\.1:\d+\): standby \(read \d+ s ago\)/);
  assert.match(check.fr, /en veille \(lu il y a \d+ s\)/);
  // The status and the devices are published again at each connection.
  const published = gladys.fake.discoveredDevices.length;
  assert.ok(published > 0);

  // A restart (same /data) does not read at once either.
  await app.stop();
  const again = new KaleidescapeApp({
    gladys,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    store,
    timers,
    timings: FAST,
  });
  t.after(() => again.stop());
  await again.start(await gladys.getConfig(), { connected: true });
  await settle(80);
  assert.equal(fake.connections, connections, 'a restart reads after a whole interval');
  // Once due, it reads.
  await readNow(again);
  assert.equal(fake.connections, connections + 1);
});

test('Power on is sent from standby only, and confirmed by the power read back', async (t) => {
  const { gladys, fake } = await setup(t);
  const device = await createDevice(gladys);
  const ack = await press(gladys, device, 'power_on');
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(fake.commands(), ['LEAVE_STANDBY']);
  await waitFor(() => gladys.fake.lastState(id('power')) === 1, 'power 1');
  const again = await press(gladys, device, 'power_on');
  assert.equal(again.success, true);
  assert.equal(fake.commands().length, 1, 'already on: nothing sent');
});

test('a command that left but is not seen done is "sent, without confirmation"', async (t) => {
  const { gladys, fake } = await setup(t, { fakeOptions: { effectMs: 5_000 } });
  const device = await createDevice(gladys);
  const ack = await press(gladys, device, 'power_on');
  assert.equal(ack.success, false);
  assert.match(ack.error, /Sent, without confirmation/);
  assert.deepEqual(fake.commands(), ['LEAVE_STANDBY']);
});

test('Play in standby is refused, nothing sent; Play when on is confirmed', async (t) => {
  const { gladys, fake } = await setup(t);
  const device = await createDevice(gladys);
  const refused = await press(gladys, device, 'play');
  assert.equal(refused.success, false);
  assert.match(refused.error, /in standby.*nothing sent/);
  assert.equal(fake.commands().length, 0);

  fake.power = '1';
  const ack = await press(gladys, device, 'play');
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(fake.commands(), ['PLAY']);
  await waitFor(() => gladys.fake.lastState(id('playing')) === 1, 'playing');
});

test('Standby, Pause and Stop: sent only when needed', async (t) => {
  const { gladys, fake } = await setup(t, { fakeOptions: { power: '1', play: '2' } });
  const device = await createDevice(gladys);
  assert.equal((await press(gladys, device, 'pause')).success, true);
  assert.equal(fake.play, '1');
  assert.equal((await press(gladys, device, 'pause')).success, true, 'already paused');
  assert.equal((await press(gladys, device, 'stop')).success, true);
  assert.equal(fake.play, '0');
  assert.equal((await press(gladys, device, 'stop')).success, true, 'already stopped');
  assert.equal((await press(gladys, device, 'standby')).success, true);
  assert.equal(fake.power, '0');
  assert.equal((await press(gladys, device, 'standby')).success, true, 'already in standby');
  assert.deepEqual(fake.commands(), ['PAUSE', 'STOP', 'ENTER_STANDBY']);
  await waitFor(() => gladys.fake.lastState(id('power_status')) === 'Standby', 'standby');
});

test('Standby is sent even when the state cannot be read', async (t) => {
  const { gladys, fake } = await setup(t, { fakeOptions: { power: '1' } });
  const device = await createDevice(gladys);
  fake.behaviour.GET_DEVICE_POWER_STATE = 'never';
  const ack = await press(gladys, device, 'standby');
  assert.deepEqual(fake.commands(), ['ENTER_STANDBY'], 'sent in a new session');
  // Never confirmed (the power never answers): said so, never "nothing sent".
  assert.equal(ack.success, false);
  assert.match(ack.error, /Sent, without confirmation/);
  assert.equal(fake.power, '0');
});

test('a protective command cancels the waking commands waiting', async (t) => {
  const { gladys, fake } = await setup(t, { fakeOptions: { power: '1', play: '1' } });
  const device = await createDevice(gladys);
  fake.behaviour.UP = 250;
  const up = press(gladys, device, 'remote_key', 'up');
  await waitFor(() => fake.received.includes('UP'), 'the key sent');
  const play = press(gladys, device, 'play');
  await settle(20);
  const stop = await press(gladys, device, 'stop');
  assert.equal(stop.success, true, stop.error);
  const played = await play;
  assert.equal(played.success, false);
  assert.match(played.error, /Cancelled by stop, nothing sent/);
  assert.ok(!fake.received.includes('PLAY'));
  assert.equal((await up).success, true);
});

test('remote keys: validated before anything is sent, refused in standby', async (t) => {
  const { gladys, fake } = await setup(t);
  const device = await createDevice(gladys);
  const connections = fake.connections;
  const bad = await press(gladys, device, 'remote_key', 'format-disk');
  assert.equal(bad.success, false);
  assert.match(bad.error, /Unknown remote key/);
  const proto = await press(gladys, device, 'remote_key', '__proto__');
  assert.equal(proto.success, false);
  const readOnly = await press(gladys, device, 'title', 'x');
  assert.equal(readOnly.success, false);
  assert.equal(fake.connections, connections, 'no connection for an invalid command');
  const standby = await press(gladys, device, 'remote_key', 'up');
  assert.equal(standby.success, false);
  assert.match(standby.error, /nothing sent/);
  fake.power = '1';
  assert.equal((await press(gladys, device, 'remote_key', 'menu')).success, true);
  assert.deepEqual(fake.commands(), ['KALEIDESCAPE_MENU_TOGGLE']);
});

test('a refusal of the player is told as such', async (t) => {
  const { gladys, fake } = await setup(t, { fakeOptions: { power: '1' } });
  const device = await createDevice(gladys);
  fake.behaviour.SELECT = 'refuse';
  const ack = await press(gladys, device, 'remote_key', 'select');
  assert.equal(ack.success, false);
  assert.match(ack.error, /refused by the player \(status 12\)/);
});

test('another player at the address: nothing sent, the address forgotten', async (t) => {
  const { gladys, fake, app } = await setup(t, { fakeOptions: { power: '1', play: '2' } });
  const device = await createDevice(gladys);
  fake.serial = '0000000ABCDE';
  const ack = await press(gladys, device, 'pause');
  assert.equal(ack.success, false);
  assert.match(ack.error, /another player answers at its address, nothing sent/);
  assert.equal(fake.commands().length, 0);
  await waitFor(
    () => gladys.fake.lastState(id('power_status')) === 'Not reachable',
    'not reachable',
  );
  await waitFor(
    () => /Address unknown/.test(gladys.fake.connectionStatus?.message?.en ?? ''),
    'the status',
  );
  // The typed address now gives the other player.
  await readNow(app);
  await discovered(gladys, '0000000abcde');
});

test('an unreadable serial number is no other player', async (t) => {
  const { gladys, fake, app } = await setup(t, { fakeOptions: { power: '1' } });
  const device = await createDevice(gladys);
  fake.behaviour.GET_DEVICE_INFO = 'refuse';
  fake.power = '0';
  await readNow(app);
  await waitFor(() => gladys.fake.lastState(id('power')) === 0, 'still read');
  const ack = await press(gladys, device, 'power_on');
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(fake.commands(), ['LEAVE_STANDBY']);
});

test('a player not answering: power 0, "Not reachable", told in the status', async (t) => {
  const { gladys, fake, app } = await setup(t, { fakeOptions: { power: '1' } });
  await createDevice(gladys);
  await fake.close();
  await readNow(app);
  await waitFor(() => gladys.fake.lastState(id('power_status')) === 'Not reachable', 'unreachable');
  assert.equal(gladys.fake.lastState(id('power')), 0);
  assert.match(gladys.fake.connectionStatus.message.en, /Not reachable/);
  assert.match(gladys.fake.connectionStatus.message.fr, /Injoignables/);
});

test('a server without a movie zone is not offered', async (t) => {
  const { gladys, fake } = await setup(t, { fakeOptions: { movieZones: '00' } });
  await waitFor(
    () => /without a movie zone/.test(gladys.fake.connectionStatus?.message?.en ?? ''),
    'the status',
  );
  assert.equal(gladys.fake.discoveredDevices.length, 0);
  assert.ok(!fake.received.includes('GET_DEVICE_POWER_STATE'));
});

test('a late read of an old configuration publishes nothing', async (t) => {
  const { gladys, fake, app } = await setup(t);
  await createDevice(gladys);
  fake.power = '1';
  fake.behaviour.GET_DEVICE_POWER_STATE = 200;
  const reading = readNow(app);
  await waitFor(
    () => fake.received.filter((n) => n === 'GET_DEVICE_POWER_STATE').length >= 2,
    'read',
  );
  const config = await gladys.getConfig();
  await app.start({ ...config, addresses: `${config.addresses}, 127.0.0.2` }, { saved: true });
  await reading;
  await settle(300);
  assert.equal(gladys.fake.lastState(id('power')), 0, 'the old read was dropped');
});

test('hostile players: garbage, silence, floods never break the integration', async (t) => {
  for (const mode of ['garbage', 'silent', 'flood', 'close']) {
    const { gladys, app, fake } = await setup(t, { fakeOptions: { mode } });
    await waitFor(
      () => /No Kaleidescape movie player/.test(gladys.fake.connectionStatus?.message?.en ?? ''),
      `the failure in the status (${mode})`,
    );
    assert.ok(app.probeErrors.size > 0, mode);
    assert.equal(gladys.fake.discoveredDevices.length, 0, mode);
    await fake.close();
  }
});
