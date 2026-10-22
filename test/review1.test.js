// -----------------------------------------------------------------------------
// Review 1: the hostile scenarios of the review (S1..S8), turned around: each
// one now checks the fixed behaviour.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { KaleidescapeApp } from '../src/app.js';
import { TIMINGS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { openSession } from '../src/kaleidescape/client.js';
import { parsePower } from '../src/kaleidescape/protocol.js';
import { StatePublisher } from '../src/publisher.js';
import { MemoryStore } from '../src/store.js';
import { SERIAL_ID, startFakePlayer } from './fixtures/fakePlayer.js';

const SELECTOR = 'kaleidescape';
const id = (key, serial = SERIAL_ID) => `ext:${SELECTOR}:player:${serial}${key ? `:${key}` : ''}`;
const QUIET = { debug() {}, info() {}, warn() {}, error() {} };
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
const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, what, timeout = 3_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) {
      return;
    }
    await settle(10);
  }
  assert.fail(`timed out waiting for ${what}`);
}

async function setup(t, { fakeOptions, store = new MemoryStore(), create = true } = {}) {
  const fake = await startFakePlayer(fakeOptions);
  t.after(() => fake.close());
  const gladys = createFakeGladys({
    selector: SELECTOR,
    config: { addresses: `127.0.0.1:${fake.port}` },
  });
  const app = new KaleidescapeApp({ gladys, logger: QUIET, store, timers, timings: FAST });
  registerHandlers(gladys, app, QUIET);
  t.after(() => app.stop());
  await gladys.connect();
  let device;
  if (create) {
    await waitFor(
      () => gladys.fake.discoveredDevices.some((d) => d.external_id === id()),
      'discovery',
    );
    device = gladys.fake.discoveredDevices.find((d) => d.external_id === id());
    await gladys.fake.deviceCreated(device);
    await waitFor(() => gladys.fake.lastState(id('power')) !== undefined, 'power');
  }
  return { fake, gladys, app, device, store };
}

const press = (gladys, device, key, value = 1) =>
  gladys.fake.setValue(
    device,
    device.features.find((f) => f.external_id === id(key)),
    value,
  );

test('S1: Standby after a Power on not applied yet is sent, never "already in standby"', async (t) => {
  const { gladys, fake, device } = await setup(t, { fakeOptions: { effectMs: 1_200 } });
  const on = await press(gladys, device, 'power_on');
  assert.match(on.error ?? '', /Sent, without confirmation/);
  await press(gladys, device, 'standby');
  assert.deepEqual(fake.commands(), ['LEAVE_STANDBY', 'ENTER_STANDBY']);
  await settle(1_500);
  assert.equal(fake.power, '0', 'the player ends in standby');
});

test('S1b: Stop and Pause after a Play not applied yet: Stop is sent', async (t) => {
  const { gladys, fake, device } = await setup(t, {
    fakeOptions: { power: '1', play: '0', effectMs: 1_200 },
  });
  const play = await press(gladys, device, 'play');
  assert.match(play.error ?? '', /Sent, without confirmation/);
  await press(gladys, device, 'stop');
  await press(gladys, device, 'pause');
  assert.deepEqual(fake.commands().slice(0, 2), ['PLAY', 'STOP']);
  await settle(1_500);
  assert.notEqual(fake.play, '2', 'the movie does not end playing');
});

test('S1c: Stop while the Play command runs (its line left) is sent', async (t) => {
  const { gladys, fake, device } = await setup(t, {
    fakeOptions: { power: '1', play: '0', effectMs: 1_200 },
  });
  const play = press(gladys, device, 'play');
  await waitFor(() => fake.received.includes('PLAY'), 'PLAY sent');
  await press(gladys, device, 'stop');
  await play;
  assert.deepEqual(fake.commands(), ['PLAY', 'STOP']);
  await settle(1_500);
  assert.equal(fake.play, '0');
});

test('M6: Power on after a Standby not applied yet is sent, never "already on"', async (t) => {
  const { gladys, fake, device } = await setup(t, { fakeOptions: { power: '1', effectMs: 1_200 } });
  const standby = await press(gladys, device, 'standby');
  assert.match(standby.error ?? '', /Sent, without confirmation/);
  await press(gladys, device, 'power_on');
  assert.deepEqual(fake.commands(), ['ENTER_STANDBY', 'LEAVE_STANDBY']);
});

test('the guard is lifted by the state read back: then "already done" again', async (t) => {
  const { gladys, fake, device, app } = await setup(t, { fakeOptions: { effectMs: 100 } });
  const on = await press(gladys, device, 'power_on');
  assert.equal(on.success, true, on.error);
  assert.equal(app.guards.size, 0, 'confirmed: no guard');
  fake.effectMs = 0;
  await press(gladys, device, 'power_on');
  assert.deepEqual(fake.commands(), ['LEAVE_STANDBY'], 'already on: nothing sent');
});

test('S4: an answer of the right sequence but another name is never taken', async (t) => {
  const server = net.createServer((socket) => {
    socket.on('data', () => socket.write('01/0/000:VIDEO_MODE:1:00:37:/89\n'));
    socket.on('error', () => {});
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const session = await openSession({
    host: '127.0.0.1',
    port: server.address().port,
    deadline: Date.now() + 2_000,
    connectTimeout: 500,
    readTimeout: 300,
  });
  await assert.rejects(session.request('GET_DEVICE_POWER_STATE'), /No answer/);
  session.close();
  assert.equal(parsePower(['1']), 'on');
});

test('S2: 50 Stop at once join one run: one session, one STOP', async (t) => {
  const { gladys, fake, device } = await setup(t, { fakeOptions: { power: '1', play: '2' } });
  fake.behaviour.GET_DEVICE_INFO = 100;
  const before = fake.connections;
  const acks = await Promise.all(Array.from({ length: 50 }, () => press(gladys, device, 'stop')));
  assert.ok(
    acks.every((a) => a.success),
    JSON.stringify(acks[0]),
  );
  assert.ok(fake.connections - before <= 2, `${fake.connections - before} sessions`);
  assert.deepEqual(fake.commands(), ['STOP']);
});

test('S6: the waking queue is bounded, the rest refused at once', async (t) => {
  const { gladys, fake, device, app } = await setup(t, { fakeOptions: { power: '1', play: '1' } });
  fake.behaviour.UP = 250;
  const up = press(gladys, device, 'remote_key', 'up');
  await waitFor(() => fake.received.includes('UP'), 'UP sent');
  const plays = Array.from({ length: 20 }, () => press(gladys, device, 'play'));
  await settle(5);
  assert.ok(app.queues.get(SERIAL_ID).items.length <= FAST.queueLength);
  const acks = await Promise.all(plays);
  const busy = acks.filter((a) => /Player busy .*nothing sent/.test(a.error ?? ''));
  assert.ok(busy.length >= 20 - FAST.queueLength, `${busy.length} refused`);
  await up;
});

test('S7: Play during a fast forward is sent', async (t) => {
  const { gladys, fake, device } = await setup(t, { fakeOptions: { power: '1', play: '4' } });
  const ack = await press(gladys, device, 'play');
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(fake.commands(), ['PLAY']);
});

test('S3: an address removed then typed again is not read sooner', async (t) => {
  const { fake, app } = await setup(t, { fakeOptions: { movieZones: '00' }, create: false });
  await waitFor(() => fake.connections === 1, 'first read');
  const address = `127.0.0.1:${fake.port}`;
  for (let i = 0; i < 3; i += 1) {
    await app.start({ addresses: '' }, { saved: true });
    await app.start({ addresses: address }, { saved: true });
    await settle(80);
  }
  assert.equal(fake.connections, 1);
});

test('S5: a forget() during a publication is kept', async () => {
  let release;
  const gladys = {
    publishStates: async () => {
      await new Promise((resolve) => {
        release = resolve;
      });
    },
  };
  const publisher = new StatePublisher({ gladys, logger: QUIET });
  const state = { device_feature_external_id: 'ext:k:player:x:power', state: 1 };
  const first = publisher.publish([state]);
  await settle(5);
  publisher.forget('ext:k:player:x');
  release();
  await first;
  const again = publisher.publish([state]);
  await settle(5);
  release();
  assert.equal(await again, 1);
});

test('S8: a failing getDevices is retried spaced, and the links follow its return', async (t) => {
  const { gladys, app } = await setup(t);
  const real = gladys.getDevices.bind(gladys);
  let calls = 0;
  gladys.getDevices = async () => {
    calls += 1;
    throw new Error('503');
  };
  await app.start(await gladys.getConfig(), { saved: true });
  for (let i = 0; i < 10; i += 1) {
    await app.tick();
  }
  assert.equal(calls, 1);
  gladys.getDevices = real;
  app.createdRetryAt = -Infinity;
  await app.tick();
  assert.equal(app.createdStale, false);
  assert.ok(app.created.has(SERIAL_ID));
});

test('M5: the second session of a protective command checks the identity again', async (t) => {
  const { gladys, fake, device } = await setup(t, { fakeOptions: { power: '1' } });
  fake.behaviour.GET_DEVICE_POWER_STATE = 'never';
  const push = fake.received.push.bind(fake.received);
  fake.received.push = (name) => {
    if (name === 'GET_DEVICE_POWER_STATE') {
      fake.serial = '0000000ABCDE';
    }
    return push(name);
  };
  const ack = await press(gladys, device, 'standby');
  assert.equal(ack.success, false);
  assert.match(ack.error, /another player answers at its address, nothing sent/);
  assert.deepEqual(fake.commands(), []);
});

test('M7: a full player table makes room for a new player', async (t) => {
  const players = {};
  for (let i = 1; i <= 10; i += 1) {
    const serial = `00000000aa${String(i).padStart(2, '0')}`;
    players[serial] = { serial, host: '', port: 10000, movieZones: 1 };
  }
  const store = new MemoryStore({ players, attempts: {} });
  const { gladys } = await setup(t, { store, create: false });
  await waitFor(
    () => gladys.fake.discoveredDevices.some((d) => d.external_id === id()),
    'the new player',
  );
});

test('M8: stop() writes the attempt times held in memory', async (t) => {
  const { app, store } = await setup(t);
  await settle(30);
  const key = [...app.links.keys()][0];
  // An attempt time held in memory only (written at most once a minute).
  const inMemory = Date.now() + 1;
  app.data.attempts[key] = inMemory;
  assert.notEqual(store.data.attempts[key], inMemory);
  await app.stop();
  assert.equal(store.data.attempts[key], inMemory);
});
