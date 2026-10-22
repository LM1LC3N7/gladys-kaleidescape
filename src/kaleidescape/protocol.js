// -----------------------------------------------------------------------------
// The Kaleidescape control protocol (TCP 10000, published by Kaleidescape),
// pure: request lines, the parsing of the answer and event lines, and the
// value maps of the states read. Ported from pykaleidescape 1.2.0 (MIT,
// kaleidescape/message.py and const.py), see THIRD_PARTY_NOTICES.md.
//
// A line is `<device id>/<seq>/<status>:<name>:<field>:<field>:/<checksum>`.
// Answers to this client carry the device id `01` and the sequence number
// (0..9) of the request; events carry `!`. Fields escape `\`, `/`, `:` and
// non-ASCII characters (`\dNNN`).
//
// Untrusted input: a line is parsed once, left to right (linear), with a
// bounded number of fields of bounded length; every value is mapped through
// fixed tables without prototype.
// -----------------------------------------------------------------------------

export const DEFAULT_PORT = 10000;
export const LOCAL_CPDID = '01';

export const LIMITS = Object.freeze({ fields: 32, field: 512 });

const table = (entries) => Object.freeze(Object.assign(Object.create(null), entries));

/** Control protocol statuses of interest (const.py). */
export const STATUS = Object.freeze({
  SUCCESS: 0,
  INVALID_DEVICE: 4,
  DEVICE_UNAVAILABLE: 5,
  INVALID_REQUEST: 10,
  DEVICE_IN_STANDBY: 20,
});

export const POWER = Object.freeze({ STANDBY: 'standby', ON: 'on' });
export const POWER_STATES = table({ 0: POWER.STANDBY, 1: POWER.ON });

export const PLAY = Object.freeze({
  NONE: 'none',
  PAUSED: 'paused',
  PLAYING: 'playing',
  FORWARD: 'forward',
  REVERSE: 'reverse',
});
export const PLAY_STATUSES = table({
  0: PLAY.NONE,
  1: PLAY.PAUSED,
  2: PLAY.PLAYING,
  4: PLAY.FORWARD,
  6: PLAY.REVERSE,
});

export const MOVIE_LOCATIONS = table({
  0: 'none',
  3: 'content',
  4: 'intermission',
  5: 'credits',
  6: 'disc_menu',
});

export const VIDEO_MODES = table({
  0: 'none',
  1: '480i60_4:3',
  2: '480i60_16:9',
  3: '480p60_4:3',
  4: '480p60_16:9',
  5: '576i50_4:3',
  6: '576i50_16:9',
  7: '576p50_4:3',
  8: '576p50_16:9',
  9: '720p60_ntsc_hd',
  10: '720p50_pal_hd',
  11: '1080i60_16:9',
  12: '1080i50_16:9',
  13: '1080p60_16:9',
  14: '1080p50_16:9',
  17: '1080p24_16:9',
  19: '480i60_64:27',
  20: '576i50_64:27',
  21: '1080i60_64:27',
  22: '1080i50_64:27',
  23: '1080p60_64:27',
  24: '1080p50_64:27',
  25: '1080p23976_64:27',
  26: '1080p24_64:27',
  27: '3840x2160p23976_16:9',
  28: '3840x2160p23976_64:27',
  29: '3840x2160p30_16:9',
  30: '3840x2160p30_64:27',
  31: '3840x2160p60_16:9',
  32: '3840x2160p60_64:27',
  33: '3840x2160p25_16:9',
  34: '3840x2160p25_64:27',
  35: '3840x2160p50_16:9',
  36: '3840x2160p50_64:27',
  37: '3840x2160p24_16:9',
  38: '3840x2160p24_64:27',
});

/** VIDEO_COLOR, first field: the transfer function (EOTF). */
export const EOTFS = table({ 0: 'unknown', 1: 'sdr', 2: 'hdr', 3: 'smpte_st2084' });

/** The requests this integration sends (names of the protocol, no field). */
export const REQUESTS = Object.freeze({
  DEVICE_INFO: 'GET_DEVICE_INFO',
  NUM_ZONES: 'GET_NUM_ZONES',
  DEVICE_TYPE_NAME: 'GET_DEVICE_TYPE_NAME',
  FRIENDLY_NAME: 'GET_FRIENDLY_NAME',
  POWER_STATE: 'GET_DEVICE_POWER_STATE',
  PLAY_STATUS: 'GET_PLAY_STATUS',
  TITLE_NAME: 'GET_PLAYING_TITLE_NAME',
  MOVIE_LOCATION: 'GET_MOVIE_LOCATION',
  VIDEO_MODE: 'GET_VIDEO_MODE',
  VIDEO_COLOR: 'GET_VIDEO_COLOR',
  LEAVE_STANDBY: 'LEAVE_STANDBY',
  ENTER_STANDBY: 'ENTER_STANDBY',
  PLAY: 'PLAY',
  PAUSE: 'PAUSE',
  STOP: 'STOP',
});

/** The name of the answer to each GET_ request (the title answers TITLE_NAME). */
export const ANSWERS = table({
  [REQUESTS.DEVICE_INFO]: 'DEVICE_INFO',
  [REQUESTS.NUM_ZONES]: 'NUM_ZONES',
  [REQUESTS.DEVICE_TYPE_NAME]: 'DEVICE_TYPE_NAME',
  [REQUESTS.FRIENDLY_NAME]: 'FRIENDLY_NAME',
  [REQUESTS.POWER_STATE]: 'DEVICE_POWER_STATE',
  [REQUESTS.PLAY_STATUS]: 'PLAY_STATUS',
  [REQUESTS.TITLE_NAME]: 'TITLE_NAME',
  [REQUESTS.MOVIE_LOCATION]: 'MOVIE_LOCATION',
  [REQUESTS.VIDEO_MODE]: 'VIDEO_MODE',
  [REQUESTS.VIDEO_COLOR]: 'VIDEO_COLOR',
});

/**
 * The navigation and playback keys offered in the "Remote key" dropdown
 * (the simple commands of pykaleidescape). Values are frozen: they are
 * stored in the scenes of the users.
 */
export const REMOTE_KEYS = Object.freeze([
  { value: 'up', label: 'Up', request: 'UP' },
  { value: 'down', label: 'Down', request: 'DOWN' },
  { value: 'left', label: 'Left', request: 'LEFT' },
  { value: 'right', label: 'Right', request: 'RIGHT' },
  { value: 'select', label: 'Select (OK)', request: 'SELECT' },
  { value: 'cancel', label: 'Cancel (Back)', request: 'CANCEL' },
  { value: 'menu', label: 'Kaleidescape menu', request: 'KALEIDESCAPE_MENU_TOGGLE' },
  { value: 'status', label: 'Status and settings', request: 'STATUS_AND_SETTINGS' },
  { value: 'next', label: 'Next chapter', request: 'NEXT' },
  { value: 'previous', label: 'Previous chapter', request: 'PREVIOUS' },
  { value: 'replay', label: 'Replay', request: 'REPLAY' },
  { value: 'scan-forward', label: 'Scan forward', request: 'SCAN_FORWARD' },
  { value: 'scan-reverse', label: 'Scan reverse', request: 'SCAN_REVERSE' },
  { value: 'intermission', label: 'Intermission', request: 'INTERMISSION_TOGGLE' },
  { value: 'movie-list', label: 'Movie list', request: 'GO_MOVIE_LIST' },
  { value: 'movie-covers', label: 'Movie covers', request: 'GO_MOVIE_COVERS' },
  { value: 'movie-collections', label: 'Movie collections', request: 'GO_MOVIE_COLLECTIONS' },
]);

/** A request line (no field: none of the requests sent here has one). */
export function requestLine(seq, name) {
  if (!Number.isInteger(seq) || seq < 0 || seq > 9 || !/^[A-Z][A-Z0-9_]{0,63}$/.test(name)) {
    throw new Error('Invalid request');
  }
  return `${LOCAL_CPDID}/${seq}/${name}:\n`;
}

const DIGIT = (c) => c >= 48 && c <= 57;

/**
 * Parses one line (without its line feed), latin1. Returns
 * { deviceId, zone, seq (-1 for an event), status, name, fields } or
 * undefined when the line is not a protocol line. Linear: each character is
 * read once.
 */
export function parseLine(line) {
  if (typeof line !== 'string' || line.length === 0) {
    return undefined;
  }
  let pos;
  // Device id: two digits, `#` + hex (a serial number) or `??`, then an optional `.zone`.
  let deviceId;
  if (line[0] === '#') {
    let end = 1;
    while (end < line.length && end <= 33 && /[0-9A-F]/.test(line[end])) {
      end += 1;
    }
    if (end === 1) {
      return undefined;
    }
    deviceId = line.slice(0, end);
    pos = end;
  } else if (line.startsWith('??')) {
    deviceId = '??';
    pos = 2;
  } else if (DIGIT(line.charCodeAt(0)) && DIGIT(line.charCodeAt(1))) {
    deviceId = line.slice(0, 2);
    pos = 2;
  } else {
    return undefined;
  }
  let zone = 0;
  if (line[pos] === '.') {
    if (!DIGIT(line.charCodeAt(pos + 1)) || !DIGIT(line.charCodeAt(pos + 2))) {
      return undefined;
    }
    zone = Number(line.slice(pos + 1, pos + 3));
    pos += 3;
  }
  if (line[pos] !== '/') {
    return undefined;
  }
  pos += 1;
  // Sequence: one digit, or `!` for an event.
  const s = line[pos];
  if (!(s === '!' || DIGIT(line.charCodeAt(pos))) || line[pos + 1] !== '/') {
    return undefined;
  }
  const seq = s === '!' ? -1 : Number(s);
  pos += 2;
  // Status: three digits and a colon.
  for (let i = 0; i < 3; i += 1) {
    if (!DIGIT(line.charCodeAt(pos + i))) {
      return undefined;
    }
  }
  if (line[pos + 3] !== ':') {
    return undefined;
  }
  const status = Number(line.slice(pos, pos + 3));
  pos += 4;
  // Name: up to the next colon; an acknowledgement has none (`/` at once).
  let name = '';
  if (line[pos] !== '/') {
    const colon = line.indexOf(':', pos);
    if (colon === -1 || colon - pos > 64) {
      return undefined;
    }
    name = line.slice(pos, colon);
    pos = colon + 1;
  }
  // Fields, each closed by a colon, until the `/` before the checksum.
  const fields = [];
  let field = '';
  let escaped = false;
  let closed = false;
  while (pos < line.length) {
    const char = line[pos];
    if (escaped) {
      escaped = false;
      if (char === 'd') {
        const code = line.slice(pos + 1, pos + 4);
        if (!/^\d{3}$/.test(code)) {
          return undefined;
        }
        field += String.fromCharCode(Number(code) & 0xff);
        pos += 3;
      } else if (char === 'r' || char === '\r') {
        field += '\r';
      } else if (char === 'n' || char === '\n') {
        field += '\n';
      } else if (char === 't') {
        field += '\t';
      } else if (char === '/' || char === '\\' || char === ':') {
        field += char;
      }
    } else if (char === '\\') {
      escaped = true;
    } else if (char === '/') {
      closed = true;
      break;
    } else if (char === ':') {
      if (fields.length >= LIMITS.fields) {
        return undefined;
      }
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
    if (field.length > LIMITS.field) {
      return undefined;
    }
    pos += 1;
  }
  // The last field must be closed by a colon, and a checksum must follow.
  if (!closed || field !== '' || !/^\d{1,6}$/.test(line.slice(pos + 1))) {
    return undefined;
  }
  return { deviceId, zone, seq, status, name, fields };
}

/** A small integer field (`"03"` -> 3), or undefined. */
export function intField(value) {
  return typeof value === 'string' && /^\d{1,6}$/.test(value) ? Number(value) : undefined;
}

const mapped = (map, value) => {
  const n = intField(value);
  return n !== undefined && Object.hasOwn(map, n) ? map[n] : undefined;
};

/** Printable text of at most `max` characters (control characters removed), or undefined. */
export function cleanText(value, max = 100) {
  if (typeof value !== 'string') {
    return undefined;
  }
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
  return text === '' ? undefined : text.slice(0, max);
}

/**
 * The serial number of DEVICE_INFO (second field), as pykaleidescape gives it
 * (the last 12 characters, zero-padded), lowercased: the identity of the
 * player and its external id. Undefined when unreadable or all zeros.
 */
export function parseSerial(fields) {
  const raw = Array.isArray(fields) ? fields[1] : undefined;
  if (typeof raw !== 'string') {
    return undefined;
  }
  const text = raw.replace(/^#/, '').trim();
  if (!/^[0-9A-Za-z]{1,32}$/.test(text)) {
    return undefined;
  }
  const serial = text.slice(-12).padStart(12, '0').toLowerCase();
  return /^0+$/.test(serial) ? undefined : serial;
}

export const parsePower = (fields) => mapped(POWER_STATES, fields?.[0]);

export function parseNumZones(fields) {
  const movie = intField(fields?.[0]);
  const music = intField(fields?.[1]);
  return movie === undefined ? undefined : { movie, music: music ?? 0 };
}

/** PLAY_STATUS: status, speed, title number, title length, title location, chapter... */
export function parsePlayStatus(fields) {
  const status = mapped(PLAY_STATUSES, fields?.[0]);
  if (!status) {
    return undefined;
  }
  return { status, chapter: intField(fields[5]) };
}

export const parseMovieLocation = (fields) => mapped(MOVIE_LOCATIONS, fields?.[0]);
export const parseVideoMode = (fields) => mapped(VIDEO_MODES, fields?.[2]);
export const parseEotf = (fields) => mapped(EOTFS, fields?.[0]);
export const parseText = (fields, max) => cleanText(fields?.[0], max);
