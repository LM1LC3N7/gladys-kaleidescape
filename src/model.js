// -----------------------------------------------------------------------------
// Known players -> Gladys devices and states (pure). One Gladys device per
// movie player, keyed by its serial number (DEVICE_INFO, as Home Assistant):
// the address may change, the serial number does not.
//
// Categories and types of the Gladys core only: `button/push` for Power on,
// Standby, Play, Pause and Stop — no switch, nothing an "everything on / off"
// (voice assistants, scenes) could turn into a command —, the power and the
// playing state read only (`unknown/binary`), `text/text` for the statuses,
// the title, the movie location and the video format, `unknown/integer` for
// the chapter, `text/select` for the remote keys. No unit anywhere.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
} from '@gladysassistant/integration-sdk';
import { DEVICE_TYPE, FEATURES, LIMITS } from './constants.js';
import { PLAY, POWER, REMOTE_KEYS } from './kaleidescape/protocol.js';

const readOnlyText = (name) => ({
  name,
  category: C.TEXT,
  type: T.TEXT.TEXT,
  min: 0,
  max: 0,
  read_only: true,
});
const button = (name) => ({ name, category: C.BUTTON, type: T.BUTTON.PUSH, min: 0, max: 1 });

/** The feature definitions, by frozen key, in their frozen order. */
export const FEATURE_SPECS = Object.freeze({
  [FEATURES.POWER]: {
    name: 'Power',
    category: C.UNKNOWN,
    type: T.SENSOR.BINARY,
    min: 0,
    max: 1,
    read_only: true,
    keep_history: true,
  },
  [FEATURES.POWER_STATUS]: readOnlyText('Power status'),
  [FEATURES.POWER_ON]: button('Power on'),
  [FEATURES.STANDBY]: button('Standby'),
  [FEATURES.PLAY]: button('Play'),
  [FEATURES.PAUSE]: button('Pause'),
  [FEATURES.STOP]: button('Stop'),
  [FEATURES.REMOTE_KEY]: {
    name: 'Remote key',
    category: C.TEXT,
    type: T.TEXT.SELECT,
    min: 0,
    max: 0,
  },
  [FEATURES.PLAYING]: {
    name: 'Playing',
    category: C.UNKNOWN,
    type: T.SENSOR.BINARY,
    min: 0,
    max: 1,
    read_only: true,
    keep_history: true,
  },
  [FEATURES.PLAY_STATUS]: readOnlyText('Play status'),
  [FEATURES.TITLE]: readOnlyText('Title'),
  [FEATURES.CHAPTER]: {
    name: 'Chapter',
    category: C.UNKNOWN,
    type: T.SENSOR.INTEGER,
    min: 0,
    max: 999,
    read_only: true,
  },
  [FEATURES.MOVIE_LOCATION]: readOnlyText('Movie location'),
  [FEATURES.VIDEO_MODE]: readOnlyText('Video mode'),
  [FEATURES.DYNAMIC_RANGE]: readOnlyText('Dynamic range'),
});

export const REMOTE_OPTIONS = Object.freeze(
  REMOTE_KEYS.map(({ value, label }) => ({ value, label })),
);

/** The texts of the text states (a text state has one language: English). */
export const POWER_TEXTS = Object.freeze({
  [POWER.ON]: 'On',
  [POWER.STANDBY]: 'Standby',
  unreachable: 'Not reachable',
});
export const PLAY_TEXTS = Object.freeze({
  [PLAY.NONE]: 'Idle',
  [PLAY.PAUSED]: 'Paused',
  [PLAY.PLAYING]: 'Playing',
  [PLAY.FORWARD]: 'Fast forward',
  [PLAY.REVERSE]: 'Rewind',
});
export const LOCATION_TEXTS = Object.freeze({
  none: 'None',
  content: 'Content',
  intermission: 'Intermission',
  credits: 'Credits',
  disc_menu: 'Disc menu',
});
export const EOTF_TEXTS = Object.freeze({
  unknown: 'Unknown',
  sdr: 'SDR',
  hdr: 'HDR',
  smpte_st2084: 'HDR10 (PQ)',
});
export const NO_TITLE = 'No title';

/** `3840x2160p24_16:9` -> `3840x2160p24 16:9`, `none` -> `None`. */
export const videoModeText = (mode) => (mode === 'none' ? 'None' : mode.replace(/_/g, ' '));

/** Playing (or scanning): what a scene "a movie plays" waits for. */
export const isPlaying = (status) =>
  status === PLAY.PLAYING || status === PLAY.FORWARD || status === PLAY.REVERSE;

export function deviceName(player) {
  return `Kaleidescape ${player.name || player.model || player.serial}`.slice(0, LIMITS.name + 13);
}

export function buildDevice(gladys, player) {
  const ids = gladys.externalIds(DEVICE_TYPE, player.serial);
  return {
    name: deviceName(player),
    external_id: ids.device,
    should_poll: false,
    params: [
      { name: 'IP_ADDRESS', value: player.host || '' },
      { name: 'MODEL', value: player.model || '' },
    ],
    // Always the full, fixed list: a device published again never loses a feature.
    features: Object.entries(FEATURE_SPECS).map(([key, { name, ...spec }]) => ({
      name,
      external_id: ids.feature(key),
      read_only: false,
      has_feedback: false,
      keep_history: false,
      ...spec,
      ...(key === FEATURES.REMOTE_KEY
        ? { supported_options: REMOTE_OPTIONS.map((o) => ({ ...o })) }
        : {}),
    })),
  };
}

/** The feature key of a feature external id of `device`, or undefined. */
export function featureKey(deviceExternalId, featureExternalId) {
  const prefix = `${deviceExternalId}:`;
  return String(featureExternalId ?? '').startsWith(prefix)
    ? String(featureExternalId).slice(prefix.length)
    : undefined;
}

/** Publication order when the state budget is short: power first, the title last. */
export const statePriority = (externalId) =>
  externalId.endsWith(`:${FEATURES.POWER}`) || externalId.endsWith(`:${FEATURES.PLAYING}`)
    ? 0
    : externalId.endsWith(`:${FEATURES.TITLE}`)
      ? 2
      : 1;

/**
 * The states of a reading. `reading` is null for a player that does not
 * answer (power 0, "Not reachable"), undefined when nothing is known (nothing
 * published), else { power, play?, title?, location?, videoMode?, eotf? }.
 * A value that could not be read is left out (what was published stays).
 */
export function stateList(gladys, player, reading) {
  if (reading === undefined) {
    return [];
  }
  const ids = gladys.externalIds(DEVICE_TYPE, player.serial);
  const number = (key, state) => ({ device_feature_external_id: ids.feature(key), state });
  const text = (key, value) => ({ device_feature_external_id: ids.feature(key), text: value });
  if (reading === null) {
    return [
      number(FEATURES.POWER, 0),
      text(FEATURES.POWER_STATUS, POWER_TEXTS.unreachable),
      number(FEATURES.PLAYING, 0),
    ];
  }
  if (reading.power !== POWER.ON && reading.power !== POWER.STANDBY) {
    return [];
  }
  const states = [
    number(FEATURES.POWER, reading.power === POWER.ON ? 1 : 0),
    text(FEATURES.POWER_STATUS, POWER_TEXTS[reading.power]),
  ];
  if (reading.power === POWER.STANDBY) {
    // Nothing plays in standby, and nothing goes out.
    states.push(
      number(FEATURES.PLAYING, 0),
      text(FEATURES.PLAY_STATUS, PLAY_TEXTS[PLAY.NONE]),
      text(FEATURES.TITLE, NO_TITLE),
      number(FEATURES.CHAPTER, 0),
      text(FEATURES.MOVIE_LOCATION, LOCATION_TEXTS.none),
      text(FEATURES.VIDEO_MODE, videoModeText('none')),
    );
    return states;
  }
  const play = reading.play;
  if (play && Object.hasOwn(PLAY_TEXTS, play.status)) {
    const idle = play.status === PLAY.NONE;
    states.push(
      number(FEATURES.PLAYING, isPlaying(play.status) ? 1 : 0),
      text(FEATURES.PLAY_STATUS, PLAY_TEXTS[play.status]),
    );
    const chapter = idle ? 0 : play.chapter;
    if (Number.isSafeInteger(chapter) && chapter >= 0 && chapter <= 999) {
      states.push(number(FEATURES.CHAPTER, chapter));
    }
    if (idle) {
      states.push(text(FEATURES.TITLE, NO_TITLE));
    } else if (typeof reading.title === 'string' && reading.title !== '') {
      states.push(text(FEATURES.TITLE, reading.title.slice(0, LIMITS.title)));
    }
  }
  if (Object.hasOwn(LOCATION_TEXTS, reading.location ?? '')) {
    states.push(text(FEATURES.MOVIE_LOCATION, LOCATION_TEXTS[reading.location]));
  }
  if (typeof reading.videoMode === 'string') {
    states.push(text(FEATURES.VIDEO_MODE, videoModeText(reading.videoMode)));
  }
  if (Object.hasOwn(EOTF_TEXTS, reading.eotf ?? '')) {
    states.push(text(FEATURES.DYNAMIC_RANGE, EOTF_TEXTS[reading.eotf]));
  }
  return states;
}
