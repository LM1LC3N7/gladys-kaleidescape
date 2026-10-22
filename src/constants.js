// -----------------------------------------------------------------------------
// Frozen keys (external ids, features, manifest actions), limits and timings.
// Every key here is stored by Gladys or by its users: never rename one.
// -----------------------------------------------------------------------------

/**
 * `gladys.externalIds(DEVICE_TYPE, <serial number>)`: the serial number of
 * DEVICE_INFO, its last 12 characters zero-padded and lowercased (as
 * pykaleidescape and Home Assistant read it). Never the address.
 */
export const DEVICE_TYPE = 'player';

export const FEATURES = Object.freeze({
  /** Read only: 1 on, 0 standby or not reachable. */
  POWER: 'power',
  /** Read only text: On, Standby, Not reachable. */
  POWER_STATUS: 'power_status',
  /** Push button: leave standby, sent only from standby. */
  POWER_ON: 'power_on',
  /** Push button: enter standby (protective: never blocked). */
  STANDBY: 'standby',
  /** Push button: play, sent only when on. */
  PLAY: 'play',
  /** Push button: pause (protective). */
  PAUSE: 'pause',
  /** Push button: stop (protective). */
  STOP: 'stop',
  /** Dropdown: one navigation or playback key per selection. */
  REMOTE_KEY: 'remote_key',
  /** Read only: 1 while a movie plays (or scans), 0 otherwise. */
  PLAYING: 'playing',
  /** Read only text: Idle, Paused, Playing, Fast forward, Rewind. */
  PLAY_STATUS: 'play_status',
  /** Read only text: the title playing. */
  TITLE: 'title',
  /** Read only: the chapter playing (0 when nothing plays). */
  CHAPTER: 'chapter',
  /** Read only text: None, Content, Intermission, Credits, Disc menu. */
  MOVIE_LOCATION: 'movie_location',
  /** Read only text: the output video mode (3840x2160p24 16:9...). */
  VIDEO_MODE: 'video_mode',
  /** Read only text: SDR, HDR, HDR10 (PQ), Unknown. */
  DYNAMIC_RANGE: 'dynamic_range',
});

export const ACTIONS = Object.freeze({
  CHECK: 'check_players',
});

export const POLL_INTERVAL = Object.freeze({ min: 10, max: 300, default: 15 });

export const TIMINGS = Object.freeze({
  /** TCP connection, and each answer (pykaleidescape: 10 s; a LAN player answers at once). */
  connectTimeout: 2_000,
  readTimeout: 2_000,
  /**
   * Gladys waits 5 s for the ack of a command: the whole command (wait in the
   * queue, connection, state read just before, request, read back) gets
   * `commandBudget`; the state read before acting `preRead` of it; the line
   * never leaves later than `commandBudget - writeMargin`.
   */
  commandBudget: 3_500,
  preRead: 1_500,
  writeMargin: 200,
  /** The read back of a command, asked again this often until the budget ends. */
  confirmStep: 250,
  /** One read of one address, all its requests included. */
  pollBudget: 6_000,
  /** The scheduler looks for due reads this often. */
  tick: 1_000,
  /** An address where no movie player was identified yet is read at most this often. */
  probeRetry: 60_000,
  /** The name, model and zones of a known player are read again this often. */
  infoRefresh: 60 * 60_000,
  /** The time of the last read of each address goes to /data at most this often. */
  attemptPersistEvery: 60_000,
  /** getDevices failed: tried again after this, doubled up to `createdRetryMax`. */
  createdRetry: 30_000,
  createdRetryMax: 5 * 60_000,
  /** The last read of an address removed from the configuration is kept this long (max interval + 1 min). */
  retiredKeep: 6 * 60_000,
  /**
   * A command line that left holds a guard until the state it asks is read
   * back, or this long at most: LEAVE_STANDBY / ENTER_STANDBY (a player
   * may take a while to wake or sleep), PLAY / PAUSE / STOP.
   */
  powerGuard: 60_000,
  playGuard: 20_000,
  /** Waking commands waiting per player, at most (more: refused at once, nothing sent). */
  queueLength: 4,
  /** Writes to /data are grouped. */
  persistDelay: 1_000,
});

export const LIMITS = Object.freeze({
  players: 10,
  addresses: 10,
  /** POST /state admits 300 states per minute per integration: this one stays under. */
  statesPerMinute: 240,
  title: 100,
  name: 60,
});
