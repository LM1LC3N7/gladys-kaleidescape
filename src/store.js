// -----------------------------------------------------------------------------
// What the integration keeps across restarts, in /data (the one writable
// volume, file mode 0600): the known players by serial number (address,
// port, model, name, movie zones), so a Standby still works right after a
// restart, and the time of the last read of each address, so a restart
// never reads sooner than the interval. Nothing else: no title, no state.
//
// The serial numbers come from the network: only 12 lowercase alphanumeric
// characters are keys, and the tables have no prototype.
// -----------------------------------------------------------------------------

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LIMITS } from './constants.js';
import { DEFAULT_PORT, cleanText } from './kaleidescape/protocol.js';

export const emptyData = () => ({
  players: Object.create(null),
  attempts: Object.create(null),
});

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const isSerial = (value) =>
  typeof value === 'string' && /^[0-9a-z]{12}$/.test(value) && !/^0+$/.test(value);
const ADDRESS_KEY = /^[a-z0-9.:-]{1,260}$/;

/** Attempt times read back are capped to `now`: a time in the future never delays a read for long. */
function sanitize(data, { now = Date.now() } = {}) {
  const base = emptyData();
  if (!isObject(data)) {
    return base;
  }
  if (isObject(data.players)) {
    for (const [serial, player] of Object.entries(data.players).slice(0, LIMITS.players)) {
      if (!isSerial(serial) || !isObject(player) || player.serial !== serial) {
        continue;
      }
      base.players[serial] = {
        serial,
        host:
          typeof player.host === 'string' && /^[a-z0-9.-]{0,253}$/.test(player.host)
            ? player.host
            : '',
        port:
          Number.isInteger(player.port) && player.port > 0 && player.port < 65536
            ? player.port
            : DEFAULT_PORT,
        model: cleanText(player.model, 40),
        name: cleanText(player.name, LIMITS.name),
        movieZones:
          Number.isInteger(player.movieZones) && player.movieZones >= 0 && player.movieZones < 100
            ? player.movieZones
            : 1,
      };
    }
  }
  if (isObject(data.attempts)) {
    for (const [key, at] of Object.entries(data.attempts).slice(0, LIMITS.addresses * 2)) {
      if (ADDRESS_KEY.test(key) && Number.isFinite(at)) {
        base.attempts[key] = Math.min(at, now);
      }
    }
  }
  return base;
}

export class FileStore {
  constructor({ dir = process.env.DATA_DIR || '/data', name = 'kaleidescape.json' } = {}) {
    this.dir = dir;
    this.path = join(dir, name);
    this.corrupted = false;
  }

  /**
   * The saved data. An unreadable file is moved aside to
   * `kaleidescape.json.bad` and `corrupted` is set, so the app says so
   * instead of silently starting over.
   */
  async load(options) {
    let text;
    try {
      text = await readFile(this.path, 'utf8');
    } catch {
      return emptyData();
    }
    try {
      return sanitize(JSON.parse(text), options);
    } catch {
      this.corrupted = true;
      const bad = `${this.path}.bad`;
      await rename(this.path, bad).catch(() => {});
      await chmod(bad, 0o600).catch(() => {});
      return emptyData();
    }
  }

  async save(data) {
    await mkdir(this.dir, { recursive: true });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
    await rename(temporary, this.path);
  }
}

/** For the tests. */
export class MemoryStore {
  constructor(data = emptyData()) {
    this.data = JSON.parse(JSON.stringify(data));
    this.saves = 0;
    this.corrupted = false;
  }

  async load(options) {
    return sanitize(JSON.parse(JSON.stringify(this.data)), options);
  }

  async save(data) {
    // Through JSON, as the file store: what a restart would read back.
    this.data = JSON.parse(JSON.stringify(data));
    this.saves += 1;
  }
}

export { sanitize as sanitizeData };
