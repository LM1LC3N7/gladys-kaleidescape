// -----------------------------------------------------------------------------
// The integration: the Kaleidescape players it knows (typed addresses,
// identified by their serial number), the Gladys devices built from them, the
// reads (one short TCP session per address and interval, never sooner, the
// time of the last one kept in /data), the commands (validated before
// anything is queued, the state read again just before acting, the line sent
// only before its deadline, confirmed only by a value read back, each
// answered within the 5 s Gladys waits for its ack) and the "Check the
// players" button. index.js only wires the SDK handlers to it
// (src/handlers.js).
//
// Power on, Standby, Play, Pause and Stop are push buttons, never a switch.
// Standby, Pause and Stop are protective: outside the queue, never blocked by
// an unread state (sent anyway), and they cancel the commands waiting (Power
// on, Play, remote keys), even one already running that has not sent its line.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { addressKey, normalizeConfig } from './config.js';
import { DEVICE_TYPE, FEATURES, LIMITS, TIMINGS } from './constants.js';
import { T } from './i18n.js';
import {
  ERROR_KINDS,
  KaleidescapeError,
  openSession as defaultOpenSession,
} from './kaleidescape/client.js';
import {
  PLAY,
  POWER,
  REMOTE_KEYS,
  REQUESTS,
  parseEotf,
  parseMovieLocation,
  parseNumZones,
  parsePlayStatus,
  parsePower,
  parseSerial,
  parseText,
  parseVideoMode,
} from './kaleidescape/protocol.js';
import { buildDevice, deviceName, featureKey, stateList } from './model.js';
import { StatePublisher } from './publisher.js';
import { FileStore, emptyData } from './store.js';

const NOTHING_SENT = 'nothing sent';
const SENT_UNCONFIRMED = 'Sent, without confirmation from the player';
const short = (value) => String(value).slice(0, 32);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/** The protective commands: outside the queue, never blocked, they cancel the others waiting. */
const PROTECTIVE = Object.freeze({
  [FEATURES.STANDBY]: REQUESTS.ENTER_STANDBY,
  [FEATURES.PAUSE]: REQUESTS.PAUSE,
  [FEATURES.STOP]: REQUESTS.STOP,
});
const WAKING = Object.freeze({
  [FEATURES.POWER_ON]: REQUESTS.LEAVE_STANDBY,
  [FEATURES.PLAY]: REQUESTS.PLAY,
});

/** An error of a command: "sent, without confirmation" once its line may have left. */
function commandError(err) {
  if (err?.sent) {
    return new KaleidescapeError(ERROR_KINDS.TIMEOUT, SENT_UNCONFIRMED, { sent: true });
  }
  const message = String(err?.message ?? err);
  return message.includes(NOTHING_SENT) || err?.kind === ERROR_KINDS.REFUSED
    ? err
    : new KaleidescapeError(err?.kind ?? ERROR_KINDS.PROTOCOL, `${message}, ${NOTHING_SENT}`);
}

export class KaleidescapeApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'kaleidescape' }),
    store = new FileStore(),
    now = Date.now,
    timers = globalThis,
    timings = TIMINGS,
    openSession = defaultOpenSession,
    createConnection,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.store = store;
    this.now = now;
    this.timers = timers;
    this.timings = timings;
    this.openSessionImpl = openSession;
    this.createConnection = createConnection;
    this.publisher = new StatePublisher({ gladys, logger, now });
    this.config = normalizeConfig();
    this.data = undefined;
    this.loading = undefined;
    /** serial -> null (not reachable) | undefined (unknown) | { power, play?, title?, location?, videoMode?, eotf? } */
    this.readings = new Map();
    /** serial -> time of the last read of its name, model and zones (memory only) */
    this.infoAt = new Map();
    /** addressKey -> { key, host, port, lastAttempt, reading } */
    this.links = new Map();
    /** addressKey -> why no movie player is known there ('server', 'serial', 'limit' or an error kind) */
    this.probeErrors = new Map();
    /** serials of the devices created in Gladys */
    this.created = new Set();
    this.createdStale = false;
    /** after a failed getDevices: the next try (spaced, doubled up to 5 minutes) */
    this.createdRetryAt = -Infinity;
    this.createdRetryDelay = 0;
    /** addressKey -> a link removed from the configuration (kept: its last read and a read in flight) */
    this.retiredLinks = new Map();
    /** serial -> { kind: 'waking' | 'protective', expect(state), until }: the last command line that left */
    this.guards = new Map();
    /** `${serial}:${key}` -> the protective command running (joined by the same key) */
    this.protectiveRuns = new Map();
    /** serial -> count of the waking lines that left (Power on, Play, keys) */
    this.wakeLines = new Map();
    /** serial -> { running, items }: the waking commands, one at a time */
    this.queues = new Map();
    /** serial -> bumped by every protective command: a waking command sees it before its line leaves */
    this.epochs = new Map();
    this.generation = 0;
    this.tickTimer = undefined;
    this.persistTimer = undefined;
    this.lastAttemptSave = -Infinity;
    this.lastStatus = undefined;
    this.warned = new Set();
    this.started = false;
  }

  // --- Lifecycle -------------------------------------------------------------

  /**
   * (Re)start with a configuration: on every connection to Gladys
   * (`connected`) and on every configuration save (`saved`). The devices and
   * the status are published again (the core keeps them in memory only), the
   * states from what was read; nothing is read sooner because of it.
   */
  async start(raw = {}, { connected = false } = {}) {
    const previous = JSON.stringify(this.config.addresses);
    this.config = normalizeConfig(raw);
    this.started = true;
    if (JSON.stringify(this.config.addresses) !== previous) {
      // A read of the old configuration publishes nothing.
      this.generation += 1;
    }
    if (connected) {
      this.lastStatus = undefined;
      this.publisher.forget();
    }
    await this.ensureData();
    if (this.tickTimer === undefined) {
      this.tickTimer = this.timers.setInterval(() => this.tick(), this.timings.tick);
    }
    await this.step('read the Gladys devices', () => this.refreshCreated());
    this.syncLinks();
    await this.step('publish the devices', () => this.publishDevices());
    await this.step('publish the states', () => this.publishAllStates());
    await this.step('publish the status', () => this.updateStatus());
    this.tick();
  }

  async ensureData() {
    if (this.data) {
      return;
    }
    // Two starts at once (connected + configuration saved) share one load.
    this.loading ??= (async () => {
      let data;
      try {
        data = await this.store.load({ now: this.now() });
      } catch {
        data = emptyData();
      }
      if (this.store.corrupted) {
        this.logger.warn('Unreadable /data/kaleidescape.json moved to kaleidescape.json.bad');
      }
      this.data = data;
    })();
    await this.loading;
  }

  async step(name, task) {
    try {
      await task();
    } catch (err) {
      this.logger.warn(`Start: could not ${name}: ${err.message}`);
    }
  }

  stop() {
    this.started = false;
    this.generation += 1;
    this.timers.clearInterval(this.tickTimer);
    this.tickTimer = undefined;
    if (this.persistTimer) {
      this.timers.clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    // Always written: the attempt times held in memory (less than a minute) too.
    return this.data ? this.store.save(this.data).catch(() => {}) : Promise.resolve();
  }

  persist() {
    if (this.persistTimer) {
      return;
    }
    this.persistTimer = this.timers.setTimeout(() => {
      this.persistTimer = undefined;
      this.store
        .save(this.data)
        .catch((err) => this.logger.warn(`Could not save /data: ${err.message}`));
    }, this.timings.persistDelay);
  }

  /** Writes /data now (what was waiting included). */
  async saveNow() {
    if (this.persistTimer) {
      this.timers.clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    try {
      await this.store.save(this.data);
    } catch (err) {
      this.logger.warn(`Could not save /data: ${err.message}`);
    }
  }

  /**
   * The time of a read of `key`, kept in /data before the read starts,
   * written at most once a minute for this alone.
   */
  async markAttempt(key) {
    this.data.attempts[key] = this.now();
    if (this.now() - this.lastAttemptSave >= this.timings.attemptPersistEvery) {
      this.lastAttemptSave = this.now();
      await this.saveNow();
    }
  }

  warnOnce(key, message) {
    if (!this.warned.has(key)) {
      this.warned.add(key);
      this.logger.warn(message);
    }
  }

  // --- Known players -----------------------------------------------------------

  get players() {
    return Object.values(this.data?.players ?? {});
  }

  playerOf(gladysDevice) {
    return this.players.find(
      (p) => this.gladys.externalIds(DEVICE_TYPE, p.serial).device === gladysDevice?.external_id,
    );
  }

  addressOf(player) {
    return { host: player.host, port: player.port };
  }

  /** The player known at the address `key` (a movie player), if any. */
  playerAt(key) {
    return this.players.find((p) => p.host && p.movieZones > 0 && addressKey(p) === key);
  }

  /**
   * Remembers the player answering at `link` by its serial number. Another
   * player that had this address lost it (DHCP): never commanded at an
   * address that is no longer its own.
   */
  remember(serial, link, info) {
    const table = this.data.players;
    let player = Object.hasOwn(table, serial) ? table[serial] : undefined;
    let changed = false;
    if (!player) {
      if (Object.keys(table).length >= LIMITS.players) {
        // Full: a player never created in Gladys makes room, one without
        // an address first (replaced, swapped, a test bench).
        // Never while the list of the created devices is unknown (getDevices failing).
        const spare = this.createdStale
          ? undefined
          : (this.players.find((p) => !this.created.has(p.serial) && !p.host) ??
            this.players.find((p) => !this.created.has(p.serial)));
        if (!spare) {
          this.warnOnce(
            'players',
            `More than ${LIMITS.players} players: the next ones are ignored`,
          );
          return undefined;
        }
        delete table[spare.serial];
        this.readings.delete(spare.serial);
        this.logger.info(`${deviceName(spare)} forgotten to make room`);
      }
      player = { serial, host: '', port: link.port, movieZones: info.zones?.movie ?? 1 };
      table[serial] = player;
      changed = true;
    }
    for (const other of this.players) {
      if (other.serial !== serial && other.host === link.host && other.port === link.port) {
        this.addressLost(other);
      }
    }
    if (player.host !== link.host || player.port !== link.port) {
      player.host = link.host;
      player.port = link.port;
      changed = true;
    }
    if (info.zones && info.zones.movie !== player.movieZones) {
      player.movieZones = info.zones.movie;
      changed = true;
    }
    for (const field of ['model', 'name']) {
      if (info[field] && info[field] !== player[field]) {
        player[field] = info[field];
        changed = true;
      }
    }
    if (changed) {
      this.persist();
      this.publishDevices().catch((err) =>
        this.logger.warn(`Could not publish the devices: ${err.message}`),
      );
    }
    return player;
  }

  /** Its address went to another player (DHCP): never commanded there again. */
  addressLost(player) {
    this.logger.warn(`${deviceName(player)}: another player answers at ${addressKey(player)}`);
    player.host = '';
    this.readings.set(player.serial, null);
    this.persist();
    this.publishStates(player).catch(() => {});
    this.syncLinks();
  }

  async publishDevices() {
    if (!this.data) {
      return;
    }
    await this.gladys.publishDiscoveredDevices(
      this.players.filter((p) => p.movieZones > 0).map((p) => buildDevice(this.gladys, p)),
    );
  }

  /**
   * The devices created in Gladys. When `getDevices` fails, the list the SDK
   * keeps (`gladys.devices`) is used, and the call is made again later
   * (30 s, doubled up to 5 minutes); once it works again, the addresses read
   * and the states follow the list.
   */
  async refreshCreated() {
    let list;
    const wasStale = this.createdStale;
    try {
      list = await this.gladys.getDevices();
      this.createdStale = false;
      this.createdRetryDelay = 0;
    } catch (err) {
      this.createdStale = true;
      this.createdRetryDelay = Math.min(
        this.timings.createdRetryMax,
        Math.max(this.timings.createdRetry, this.createdRetryDelay * 2),
      );
      this.createdRetryAt = this.now() + this.createdRetryDelay;
      if (!Array.isArray(this.gladys.devices)) {
        throw err;
      }
      this.logger.warn(`Could not read the Gladys devices (${err.message}): using the last list`);
      list = this.gladys.devices;
    }
    const byExternalId = new Map(
      this.players.map((p) => [this.gladys.externalIds(DEVICE_TYPE, p.serial).device, p.serial]),
    );
    this.created = new Set(
      (Array.isArray(list) ? list : [])
        .map((d) => byExternalId.get(d?.external_id))
        .filter(Boolean),
    );
    if (wasStale && !this.createdStale) {
      this.syncLinks();
      await this.publishAllStates();
    }
  }

  // --- Reads -------------------------------------------------------------------------

  /**
   * The addresses read: the typed ones, and those of the created players.
   * A new address starts from the time of its last read kept in /data.
   */
  syncLinks() {
    if (!this.data) {
      return;
    }
    const wanted = new Map();
    for (const address of this.config.addresses) {
      wanted.set(addressKey(address), address);
    }
    for (const player of this.players) {
      if (player.host && this.created.has(player.serial)) {
        wanted.set(addressKey(player), this.addressOf(player));
      }
    }
    for (const [key, link] of [...this.links]) {
      if (!wanted.has(key)) {
        // Kept aside: typed again, it goes on from its last read (and a
        // read still in flight is joined, never doubled).
        this.links.delete(key);
        this.retiredLinks.set(key, link);
      }
    }
    // The attempt times of the addresses no longer read are kept until no
    // interval could still be running (5 minutes + 1 minute).
    for (const [key, at] of Object.entries(this.data.attempts)) {
      if (!wanted.has(key) && this.now() - at > this.timings.retiredKeep) {
        delete this.data.attempts[key];
      }
    }
    for (const [key, link] of [...this.retiredLinks]) {
      if (
        this.retiredLinks.size > LIMITS.addresses * 2 ||
        (!link.reading && this.now() - link.lastAttempt > this.timings.retiredKeep)
      ) {
        this.retiredLinks.delete(key);
      }
    }
    for (const [key, address] of wanted) {
      if (this.links.has(key)) {
        continue;
      }
      const retired = this.retiredLinks.get(key);
      if (retired && retired.host === address.host && retired.port === address.port) {
        this.retiredLinks.delete(key);
        this.links.set(key, retired);
        continue;
      }
      const saved = this.data.attempts[key];
      const link = { key, ...address, lastAttempt: -Infinity, reading: undefined };
      if (Number.isFinite(saved)) {
        // A read made shortly before a restart may not be in /data yet
        // (written at most once a minute): a recent one waits a whole interval.
        link.lastAttempt =
          this.now() - saved < this.timings.attemptPersistEvery + this.config.pollInterval * 1000
            ? this.now()
            : saved;
      }
      this.links.set(key, link);
    }
  }

  /** The wait between two reads of an address: the interval, a minute at least without a player. */
  readDelay(link) {
    const interval = this.config.pollInterval * 1000;
    return this.playerAt(link.key) ? interval : Math.max(interval, this.timings.probeRetry);
  }

  isDue(link) {
    return !link.reading && this.now() - link.lastAttempt >= this.readDelay(link);
  }

  /** Every due address is read; the others wait. Never sooner than their interval. */
  tick() {
    if (!this.started || !this.data) {
      return Promise.resolve();
    }
    return Promise.resolve()
      .then(() =>
        this.createdStale && this.now() >= this.createdRetryAt ? this.refreshCreated() : undefined,
      )
      .then(() =>
        Promise.all([...this.links.values()].filter((l) => this.isDue(l)).map((l) => this.read(l))),
      )
      .catch((err) => this.logger.warn(`Reading failed: ${err.message}`));
  }

  /** One read at a time per address: asked again while reading, it joins the running one. */
  read(link) {
    if (!link.reading) {
      link.reading = this.readLink(link)
        .catch((err) => this.logger.warn(`Read of ${link.key} failed: ${err.message}`))
        .finally(() => {
          link.reading = undefined;
        });
    }
    return link.reading;
  }

  /** A read that may fail without failing the session read (a timeout closes the session). */
  async soft(task) {
    try {
      return await task();
    } catch {
      return undefined;
    }
  }

  /**
   * Reads one address: the serial number (the address may now be another
   * player's), the name, model and zones when needed, the power, and, when
   * on, the play status, title, movie location and video format. Only the
   * power is needed; the other values may fail alone. A late answer of a
   * link removed, a configuration changed or a stopped app publishes
   * nothing and sets no status.
   */
  async readLink(link) {
    const generation = this.generation;
    const alive = () =>
      this.started && generation === this.generation && this.links.get(link.key) === link;
    link.lastAttempt = this.now();
    await this.markAttempt(link.key);
    if (!alive()) {
      return;
    }
    let result;
    try {
      result = await this.withSession(link, this.now() + this.timings.pollBudget, (session) =>
        this.readSession(session, link),
      );
    } catch (err) {
      result = err.kind === ERROR_KINDS.UNREACHABLE ? null : { error: err.kind ?? 'protocol' };
      this.logger.debug?.(`${link.key}: ${err.message}`);
    }
    if (!alive()) {
      return;
    }
    let player = this.playerAt(link.key);
    if (result === null) {
      if (!player) {
        this.probeErrors.set(link.key, ERROR_KINDS.UNREACHABLE);
      } else {
        this.readings.set(player.serial, null);
      }
    } else if (result.error) {
      // Unknown: what was known stays.
      if (!player) {
        this.probeErrors.set(link.key, result.error);
      }
    } else {
      if (result.serial) {
        if (player && player.serial !== result.serial) {
          this.addressLost(player);
        }
        const known = Object.hasOwn(this.data.players, result.serial);
        if (result.zones?.movie === 0) {
          this.probeErrors.set(link.key, 'server');
          this.warnOnce(
            `server:${link.key}`,
            `${link.key}: a server without a movie zone, ignored`,
          );
          player = undefined;
        } else if (!known && !result.zones) {
          // A new player whose zones did not answer: identified at the next try.
          this.probeErrors.set(link.key, 'serial');
          player = undefined;
        } else {
          player = this.remember(result.serial, link, result);
          if (!player) {
            this.probeErrors.set(link.key, 'limit');
          } else if (result.zones || result.model || result.name) {
            this.infoAt.set(player.serial, this.now());
          }
        }
      } else if (!player) {
        // An unreadable serial number is no other player, but no identity either.
        this.probeErrors.set(link.key, 'serial');
      }
      if (player) {
        this.probeErrors.delete(link.key);
        this.readings.set(player.serial, result.reading);
        this.liftGuard(player, result.reading);
      }
    }
    if (player) {
      await this.publishStates(player);
    }
    if (alive()) {
      await this.updateStatus();
    }
  }

  async readSession(session, link) {
    const known = this.playerAt(link.key);
    const serial = parseSerial(
      (await this.soft(() => session.request(REQUESTS.DEVICE_INFO)))?.fields,
    );
    const result = { serial };
    const player =
      serial && Object.hasOwn(this.data.players, serial) ? this.data.players[serial] : undefined;
    // Name, model and zones: for a player new here, then once an hour.
    const needInfo =
      serial &&
      (!player ||
        player !== known ||
        this.now() - (this.infoAt.get(serial) ?? -Infinity) >= this.timings.infoRefresh);
    if (needInfo) {
      result.zones = parseNumZones(
        (await this.soft(() => session.request(REQUESTS.NUM_ZONES)))?.fields,
      );
      result.model = parseText(
        (await this.soft(() => session.request(REQUESTS.DEVICE_TYPE_NAME)))?.fields,
        40,
      );
      if ((result.zones?.movie ?? player?.movieZones ?? 0) > 0) {
        result.name = parseText(
          (await this.soft(() => session.request(REQUESTS.FRIENDLY_NAME)))?.fields,
          LIMITS.name,
        );
      }
    }
    if (result.zones?.movie === 0) {
      return result;
    }
    const power = parsePower((await session.request(REQUESTS.POWER_STATE)).fields);
    if (!power) {
      throw new KaleidescapeError(ERROR_KINDS.PROTOCOL, 'Unknown power state');
    }
    const reading = { power };
    if (power === POWER.ON) {
      Object.assign(reading, await this.readPlayback(session));
    }
    result.reading = reading;
    return result;
  }

  /** What plays, when on: each value may fail alone. */
  async readPlayback(session, until) {
    const ask = async (name) => (await this.soft(() => session.request(name, { until })))?.fields;
    const out = {};
    out.play = parsePlayStatus(await ask(REQUESTS.PLAY_STATUS));
    if (out.play && out.play.status !== PLAY.NONE) {
      out.title = parseText(await ask(REQUESTS.TITLE_NAME), LIMITS.title);
    }
    out.location = parseMovieLocation(await ask(REQUESTS.MOVIE_LOCATION));
    out.videoMode = parseVideoMode(await ask(REQUESTS.VIDEO_MODE));
    out.eotf = parseEotf(await ask(REQUESTS.VIDEO_COLOR));
    return out;
  }

  async publishStates(player) {
    if (!this.created.has(player.serial)) {
      return;
    }
    await this.publisher.publish(stateList(this.gladys, player, this.readings.get(player.serial)));
  }

  async publishAllStates() {
    const states = this.players
      .filter((p) => this.created.has(p.serial))
      .flatMap((p) => stateList(this.gladys, p, this.readings.get(p.serial)));
    await this.publisher.publish(states);
  }

  /** Values a command read back: kept as the last read, published (never awaited). */
  noteState(player, state) {
    if (!state?.power) {
      return;
    }
    const previous = this.readings.get(player.serial);
    const reading =
      state.power === POWER.STANDBY
        ? { power: POWER.STANDBY }
        : { ...(previous?.power === POWER.ON ? previous : {}), power: POWER.ON };
    if (state.power === POWER.ON && state.play) {
      reading.play = state.play;
      if (state.play.status === PLAY.NONE) {
        delete reading.title;
      }
    }
    this.readings.set(player.serial, reading);
    this.liftGuard(player, reading);
    this.publishStates(player).catch(() => {});
  }

  // --- Guards ------------------------------------------------------------------------

  /**
   * The last command line that left for a player, until the state it asks is
   * read back (or its bounded expiry): while a waking line (LEAVE_STANDBY,
   * PLAY) may still be applied, a Standby, Pause or Stop never takes the
   * "already done" shortcut, and the other way round.
   */
  setGuard(player, kind, expect, duration) {
    this.guards.set(player.serial, { kind, expect, until: this.now() + duration });
  }

  /** True when a line of the other kind may still be applied. */
  guardAgainst(player, kind) {
    const guard = this.guards.get(player.serial);
    if (!guard) {
      return false;
    }
    if (this.now() > guard.until) {
      this.guards.delete(player.serial);
      return false;
    }
    return guard.kind !== kind;
  }

  /** A value read back equal to the one asked lifts the guard. */
  liftGuard(player, reading) {
    const guard = this.guards.get(player.serial);
    if (guard && reading?.power && guard.expect(reading)) {
      this.guards.delete(player.serial);
    }
  }

  // --- Sessions ------------------------------------------------------------------------

  /** Runs `task(session)` in one session with the player at `address`, before `deadline`. */
  async withSession(address, deadline, task) {
    if (!address.host) {
      throw new KaleidescapeError(
        ERROR_KINDS.UNREACHABLE,
        'Address unknown, type its new address in the configuration',
      );
    }
    const session = await this.openSessionImpl({
      host: address.host,
      port: address.port,
      deadline,
      connectTimeout: this.timings.connectTimeout,
      readTimeout: this.timings.readTimeout,
      now: this.now,
      createConnection: this.createConnection,
    });
    try {
      return await task(session);
    } finally {
      session.close();
    }
  }

  // --- Commands ------------------------------------------------------------------------

  epochOf(player) {
    return this.epochs.get(player.serial) ?? 0;
  }

  /** A protective command cancels the waking commands waiting (and one running before its line). */
  cancelWaking(player, key) {
    this.epochs.set(player.serial, this.epochOf(player) + 1);
    const queue = this.queues.get(player.serial);
    for (const item of queue?.items.splice(0) ?? []) {
      item.reject(
        new KaleidescapeError(ERROR_KINDS.BUDGET, `Cancelled by ${key}, ${NOTHING_SENT}`),
      );
    }
  }

  /** The waking commands of one player, one at a time. */
  enqueue(serial, task) {
    let queue = this.queues.get(serial);
    if (!queue) {
      queue = { running: false, items: [] };
      this.queues.set(serial, queue);
    }
    if (queue.items.length >= this.timings.queueLength) {
      return Promise.reject(
        new KaleidescapeError(
          ERROR_KINDS.BUDGET,
          `Player busy (${queue.items.length} commands waiting), ${NOTHING_SENT}`,
        ),
      );
    }
    return new Promise((resolve, reject) => {
      queue.items.push({ task, resolve, reject });
      this.drain(queue);
    });
  }

  async drain(queue) {
    if (queue.running) {
      return;
    }
    queue.running = true;
    while (queue.items.length > 0) {
      const item = queue.items.shift();
      try {
        item.resolve(await item.task());
      } catch (err) {
        item.reject(err);
      }
    }
    queue.running = false;
  }

  /** Validates a command before anything is queued or sent: the request it sends. */
  validate(key, value) {
    if (Object.hasOwn(PROTECTIVE, key)) {
      return PROTECTIVE[key];
    }
    if (Object.hasOwn(WAKING, key)) {
      return WAKING[key];
    }
    if (key === FEATURES.REMOTE_KEY) {
      const remote =
        typeof value === 'string' ? REMOTE_KEYS.find((k) => k.value === value) : undefined;
      if (!remote) {
        throw new Error(`Unknown remote key "${short(value)}"`);
      }
      return remote.request;
    }
    throw new Error(`Feature "${short(key)}" cannot be commanded`);
  }

  async setValue(gladysDevice, feature, value) {
    const player = this.playerOf(gladysDevice);
    if (!player) {
      throw new Error(`Unknown player ${short(gladysDevice?.external_id)}`);
    }
    const key = featureKey(gladysDevice.external_id, feature?.external_id);
    const request = this.validate(key, value);
    // The budget runs from the request of Gladys, the wait in the queue included.
    const started = this.now();
    // Set just before a command line leaves: from then on it may have reached
    // the player, whatever happens next.
    let context = { mayHaveSent: false, late: false };
    let run;
    if (Object.hasOwn(PROTECTIVE, key)) {
      this.cancelWaking(player, key);
      // The same protective command already running for this player is
      // joined (same answer): never delayed, never a session more.
      const joinKey = `${player.serial}:${key}`;
      // Joined only while no waking line left since that run began: after a
      // PLAY sent meanwhile, this Stop is a new run (and its line goes).
      const wakeCount = this.wakeLines.get(player.serial) ?? 0;
      const running = this.protectiveRuns.get(joinKey);
      if (running && running.wakeCount === wakeCount) {
        ({ run, context } = running);
      } else {
        run = this.protective(player, key, request, started, context);
        const entry = { run, context, wakeCount };
        this.protectiveRuns.set(joinKey, entry);
        const clear = () => {
          if (this.protectiveRuns.get(joinKey) === entry) {
            this.protectiveRuns.delete(joinKey);
          }
        };
        run.then(clear, clear);
      }
    } else {
      const epoch = this.epochOf(player);
      run = this.enqueue(player.serial, () =>
        this.waking(player, key, request, started, context, epoch),
      );
    }
    run = run.catch((err) => {
      throw commandError(err);
    });
    // Wall-clock deadline (not the injectable timers): the ack Gladys waits for.
    let timer;
    const deadline = new Promise((resolve, reject) => {
      timer = setTimeout(
        () => {
          context.late = true;
          reject(
            context.mayHaveSent
              ? new KaleidescapeError(ERROR_KINDS.TIMEOUT, SENT_UNCONFIRMED, { sent: true })
              : new KaleidescapeError(
                  ERROR_KINDS.BUDGET,
                  `No time left for this command (player busy), ${NOTHING_SENT}`,
                ),
          );
        },
        Math.max(0, this.timings.commandBudget - (this.now() - started)) + 100,
      );
    });
    run.catch(() => {});
    try {
      return await Promise.race([run, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * The serial number, power and play status, read just before acting,
   * before `until`. Another player at the address: nothing sent, the address
   * forgotten. An unreadable serial number is no other player.
   */
  async readBefore(session, player, until) {
    await this.checkIdentity(session, player, until);
    const power = parsePower((await session.request(REQUESTS.POWER_STATE, { until })).fields);
    if (!power) {
      throw new KaleidescapeError(ERROR_KINDS.PROTOCOL, 'Unknown power state');
    }
    const state = { power };
    if (power === POWER.ON) {
      const fields = (await this.soft(() => session.request(REQUESTS.PLAY_STATUS, { until })))
        ?.fields;
      state.play = parsePlayStatus(fields);
    }
    return state;
  }

  /** Only a valid, different serial number is another player: nothing sent, address forgotten. */
  async checkIdentity(session, player, until) {
    const info = await this.soft(() => session.request(REQUESTS.DEVICE_INFO, { until }));
    const serial = parseSerial(info?.fields);
    if (serial && serial !== player.serial) {
      this.addressLost(player);
      this.updateStatus().catch(() => {});
      const err = new KaleidescapeError(
        ERROR_KINDS.PROTOCOL,
        `${deviceName(player)}: another player answers at its address, ${NOTHING_SENT}`,
      );
      err.lost = true;
      throw err;
    }
  }

  /**
   * Sends `request`, only before its deadline and while no protective command
   * came (`epoch`), then reads the state back until `confirmed(state)` or the
   * deadline: never answered as done without a value read back equal to the
   * one asked ("sent, without confirmation" otherwise). `fromTarget`: the
   * line goes under an opposite guard while the state read already equals
   * the target: done only once another state was seen first, and the
   * opposite guard is kept (it expires or its own state lifts it).
   */
  async sendAndConfirm(
    session,
    player,
    request,
    deadline,
    context,
    { epoch, confirmed, kind, fromTarget = false },
  ) {
    await session.request(request, {
      until: deadline,
      command: true,
      beforeWrite: () => {
        if (epoch !== undefined && epoch !== this.epochOf(player)) {
          throw new KaleidescapeError(
            ERROR_KINDS.BUDGET,
            `Cancelled by a later Standby, Pause or Stop, ${NOTHING_SENT}`,
          );
        }
        if (context.late || this.now() > deadline - this.timings.writeMargin) {
          throw new KaleidescapeError(
            ERROR_KINDS.BUDGET,
            `No time left for this command, ${NOTHING_SENT}`,
          );
        }
        context.mayHaveSent = true;
        if (kind === 'waking') {
          this.wakeLines.set(player.serial, (this.wakeLines.get(player.serial) ?? 0) + 1);
        }
        if (confirmed && !fromTarget) {
          // From now on the line may be applied, even late: guarded until
          // its state is read back or the guard expires.
          const power = request === REQUESTS.LEAVE_STANDBY || request === REQUESTS.ENTER_STANDBY;
          this.setGuard(
            player,
            kind,
            confirmed,
            power ? this.timings.powerGuard : this.timings.playGuard,
          );
        }
      },
    });
    if (!confirmed) {
      // A remote key changes no state: the answer of the player is its confirmation.
      return;
    }
    // From the target state, the target read back proves nothing until a
    // move away from it was seen.
    let moved = !fromTarget;
    while (this.now() + this.timings.confirmStep < deadline - this.timings.writeMargin) {
      await sleep(this.timings.confirmStep);
      let state;
      try {
        state = await this.readBefore(session, player, deadline - this.timings.writeMargin);
      } catch {
        break;
      }
      this.noteState(player, state);
      if (!confirmed(state)) {
        moved = true;
      } else if (moved) {
        return;
      }
    }
    throw new KaleidescapeError(ERROR_KINDS.TIMEOUT, SENT_UNCONFIRMED, { sent: true });
  }

  /** Power on, Play, remote keys: from the queue, decided on the state read just before. */
  async waking(player, key, request, started, context, epoch) {
    const deadline = started + this.timings.commandBudget;
    if (context.late || this.now() > deadline - this.timings.writeMargin) {
      // Gladys stopped waiting while this command was queued: never sent late.
      throw new KaleidescapeError(
        ERROR_KINDS.BUDGET,
        `No time left for this command, ${NOTHING_SENT}`,
      );
    }
    if (epoch !== this.epochOf(player)) {
      throw new KaleidescapeError(
        ERROR_KINDS.BUDGET,
        `Cancelled by a later Standby, Pause or Stop, ${NOTHING_SENT}`,
      );
    }
    const name = deviceName(player);
    return this.withSession(this.addressOf(player), deadline, async (session) => {
      let state;
      try {
        state = await this.readBefore(
          session,
          player,
          Math.min(deadline, this.now() + this.timings.preRead),
        );
      } catch (err) {
        if (err.lost) {
          throw err;
        }
        throw new KaleidescapeError(err.kind, `State not read (${err.message}), ${NOTHING_SENT}`);
      }
      this.noteState(player, state);
      const send = (confirmed) =>
        this.sendAndConfirm(session, player, request, deadline, context, {
          epoch,
          confirmed,
          kind: 'waking',
          fromTarget: Boolean(confirmed && guarded && confirmed(state)),
        });
      // A Standby, Pause or Stop that left may not be applied yet: never
      // "already done" then, the line goes.
      const guarded = this.guardAgainst(player, 'waking');
      if (key === FEATURES.POWER_ON) {
        if (state.power === POWER.ON && !guarded) {
          return undefined;
        }
        return send((s) => s.power === POWER.ON);
      }
      if (state.power !== POWER.ON) {
        throw new KaleidescapeError(
          ERROR_KINDS.REFUSED,
          `${name} is in standby (press Power on first), ${NOTHING_SENT}`,
        );
      }
      if (key === FEATURES.PLAY) {
        // Only a plain playback is "already playing": a scan or rewind gets PLAY.
        if (state.play?.status === PLAY.PLAYING && !guarded) {
          return undefined;
        }
        return send((s) => s.power === POWER.ON && s.play?.status === PLAY.PLAYING);
      }
      return send(undefined);
    });
  }

  /**
   * Standby, Pause, Stop: never queued, never refused because the state could
   * not be read (sent anyway, in a new session if this one broke). Nothing is
   * sent only when the state read says it is already done, when another
   * player answers at the address, or when no session can be opened in time.
   */
  async protective(player, key, request, started, context) {
    const deadline = started + this.timings.commandBudget;
    const address = this.addressOf(player);
    const confirmed =
      key === FEATURES.STANDBY
        ? (s) => s.power === POWER.STANDBY
        : key === FEATURES.PAUSE
          ? (s) => s.power === POWER.STANDBY || s.play?.status === PLAY.PAUSED
          : (s) => s.power === POWER.STANDBY || s.play?.status === PLAY.NONE;
    const done = (s) =>
      key === FEATURES.STANDBY
        ? s.power === POWER.STANDBY
        : s.power === POWER.STANDBY ||
          s.play?.status === PLAY.NONE ||
          (key === FEATURES.PAUSE && s.play?.status === PLAY.PAUSED);
    let blind = false;
    try {
      await this.withSession(address, deadline, async (session) => {
        let state;
        try {
          state = await this.readBefore(
            session,
            player,
            Math.min(deadline, this.now() + this.timings.preRead),
          );
        } catch (err) {
          if (err.lost) {
            throw err;
          }
        }
        if (state) {
          this.noteState(player, state);
          // A waking line that left may not be applied yet: never "already
          // done" then, the line goes.
          if (done(state) && !this.guardAgainst(player, 'protective')) {
            return;
          }
        }
        if (session.failure) {
          blind = true;
          return;
        }
        await this.sendAndConfirm(session, player, request, deadline, context, {
          confirmed,
          kind: 'protective',
          // Here only under a waking guard: the target read proves nothing yet.
          fromTarget: Boolean(state && confirmed(state)),
        });
      });
    } catch (err) {
      if (err.lost || err.sent || context.mayHaveSent || err.kind === ERROR_KINDS.REFUSED) {
        throw err;
      }
      if (err.kind === ERROR_KINDS.UNREACHABLE || err.kind === ERROR_KINDS.BUDGET) {
        throw err;
      }
      blind = true;
    }
    if (blind) {
      this.logger.info(`${deviceName(player)}: ${key} sent without a state read`);
      await this.withSession(address, deadline, async (session) => {
        // The identity again (soft): a valid, different serial number sends
        // nothing; an unreadable one does not stop the protective line.
        await this.checkIdentity(
          session,
          player,
          Math.min(deadline, this.now() + this.timings.preRead),
        );
        if (session.failure) {
          // DEVICE_INFO broke this one too: the line goes in a last session.
          return this.withSession(address, deadline, (last) =>
            this.sendAndConfirm(last, player, request, deadline, context, {
              confirmed,
              kind: 'protective',
            }),
          );
        }
        return this.sendAndConfirm(session, player, request, deadline, context, {
          confirmed,
          kind: 'protective',
        });
      });
    }
  }

  // --- Device lifecycle --------------------------------------------------------------

  async deviceCreated(gladysDevice) {
    const player = this.playerOf(gladysDevice);
    if (!player) {
      return;
    }
    this.created.add(player.serial);
    this.syncLinks();
    // The SDK forgot what was published for this device: everything again,
    // from what was read (never a read sooner because of it).
    this.publisher.forget(this.gladys.externalIds(DEVICE_TYPE, player.serial).device);
    await this.publishStates(player);
    await this.updateStatus();
  }

  async deviceDeleted(gladysDevice) {
    const player = this.playerOf(gladysDevice);
    if (player) {
      this.created.delete(player.serial);
      this.syncLinks();
      await this.updateStatus();
    }
  }

  // --- Configuration screen button -------------------------------------------------

  /**
   * Reads the addresses whose interval has passed (never sooner), then tells
   * what is known of each player and each typed address.
   */
  async checkPlayers() {
    await Promise.all(
      [...this.links.values()].filter((l) => this.isDue(l)).map((l) => this.read(l)),
    );
    const lines = [];
    for (const player of this.players.filter((p) => p.movieZones > 0)) {
      const link = player.host ? this.links.get(addressKey(player)) : undefined;
      const label = `${deviceName(player)} (${player.host ? addressKey(player) : '?'})`;
      const seconds =
        link && Number.isFinite(link.lastAttempt)
          ? Math.max(0, Math.round((this.now() - link.lastAttempt) / 1000))
          : undefined;
      lines.push(
        T.checkLine(label, player.host ? this.readings.get(player.serial) : null, seconds),
      );
    }
    for (const address of this.config.addresses) {
      const key = addressKey(address);
      if (!this.playerAt(key)) {
        lines.push(T.addressLine(key, this.probeErrors.get(key)));
      }
    }
    if (lines.length === 0) {
      return T.noPlayer;
    }
    return T.check(lines, this.config.pollInterval);
  }

  // --- Status ---------------------------------------------------------------------

  async updateStatus() {
    if (!this.started || !this.data) {
      return;
    }
    const notes = [];
    if (this.store.corrupted) {
      notes.push(T.dataReset);
    }
    if (this.config.invalid.length > 0) {
      notes.push(T.invalidEntries(this.config.invalid));
    }
    const typed = this.config.addresses.map(addressKey).filter((key) => !this.playerAt(key));
    const servers = typed.filter((key) => this.probeErrors.get(key) === 'server');
    if (servers.length > 0) {
      notes.push(T.serverOnly(servers));
    }
    const silent = typed.filter(
      (key) => this.probeErrors.has(key) && this.probeErrors.get(key) !== 'server',
    );
    if (silent.length > 0) {
      notes.push(T.noAnswerAt(silent));
    }
    const lost = this.players.filter((p) => this.created.has(p.serial) && !p.host);
    if (lost.length > 0) {
      notes.push(T.addressUnknown(lost.map(deviceName)));
    }
    const off = this.players
      .filter((p) => this.created.has(p.serial) && p.host && this.readings.get(p.serial) === null)
      .map(deviceName);
    if (off.length > 0) {
      notes.push(T.unreachable(off));
    }
    // A local integration without account: "connected" means running.
    const status = { connected: true };
    if (notes.length > 0) {
      status.message = {
        en: notes.map((n) => n.en).join(' '),
        fr: notes.map((n) => n.fr).join(' '),
      };
    }
    const key = JSON.stringify(status);
    if (key === this.lastStatus) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.lastStatus = key;
    } catch (err) {
      this.logger.warn(`Could not publish the status: ${err.message}`);
    }
  }
}
