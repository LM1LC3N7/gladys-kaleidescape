// -----------------------------------------------------------------------------
// The texts users read in Gladys (configuration button, connection status),
// in English and French.
// -----------------------------------------------------------------------------

const both = (en, fr) => ({ en, fr });
const list = (items) => items.join(', ');

const POWER_EN = { on: 'on', standby: 'standby' };
const POWER_FR = { on: 'allumé', standby: 'en veille' };
const PLAY_EN = {
  none: 'idle',
  paused: 'paused',
  playing: 'playing',
  forward: 'fast forward',
  reverse: 'rewind',
};
const PLAY_FR = {
  none: 'à l’arrêt',
  paused: 'en pause',
  playing: 'en lecture',
  forward: 'avance rapide',
  reverse: 'retour rapide',
};

const ago = (seconds) =>
  seconds === undefined
    ? both('', '')
    : both(` (read ${seconds} s ago)`, ` (lu il y a ${seconds} s)`);

export const T = {
  noPlayer: both(
    'No movie player known yet: type their IP addresses in the configuration (the player must be on the network; standby is fine).',
    'Aucun lecteur connu : saisissez leurs adresses IP dans la configuration (le lecteur doit être sur le réseau ; la veille convient).',
  ),
  check: (lines, interval) => ({
    en: [...lines.map((l) => l.en), `Refresh every ${interval} s`].join(' · '),
    fr: [...lines.map((l) => l.fr), `Rafraîchissement toutes les ${interval} s`].join(' · '),
  }),
  /** One line of "Check the players": `reading` null (not reachable), undefined (unknown) or a reading. */
  checkLine: (label, reading, seconds) => {
    const when = ago(seconds);
    if (reading === null) {
      return both(
        `${label}: not reachable (off or wrong address)${when.en}`,
        `${label} : injoignable (éteint ou mauvaise adresse)${when.fr}`,
      );
    }
    if (!reading || !Object.hasOwn(POWER_EN, reading.power)) {
      return both(`${label}: state unknown${when.en}`, `${label} : état inconnu${when.fr}`);
    }
    const en = [POWER_EN[reading.power]];
    const fr = [POWER_FR[reading.power]];
    if (reading.power === 'on' && reading.play && Object.hasOwn(PLAY_EN, reading.play.status)) {
      en.push(PLAY_EN[reading.play.status]);
      fr.push(PLAY_FR[reading.play.status]);
      if (reading.play.status !== 'none' && reading.title) {
        en.push(`"${reading.title}"`);
        fr.push(`« ${reading.title} »`);
      }
    }
    return both(`${label}: ${en.join(', ')}${when.en}`, `${label} : ${fr.join(', ')}${when.fr}`);
  },
  addressLine: (key, kind) => {
    if (kind === 'server') {
      return both(
        `${key}: a Kaleidescape server without a movie zone (ignored)`,
        `${key} : un serveur Kaleidescape sans zone de film (ignoré)`,
      );
    }
    if (kind === 'serial') {
      return both(
        `${key}: answers, but its serial number or zones could not be read (tried again every minute)`,
        `${key} : répond, mais son numéro de série ou ses zones sont illisibles (nouvel essai chaque minute)`,
      );
    }
    if (kind === 'limit') {
      return both(
        `${key}: too many players (10 at most)`,
        `${key} : trop de lecteurs (10 au plus)`,
      );
    }
    if (kind === undefined) {
      return both(`${key}: not read yet`, `${key} : pas encore lu`);
    }
    return both(
      `${key}: no Kaleidescape player answers (tried again every minute)`,
      `${key} : aucun lecteur Kaleidescape ne répond (nouvel essai chaque minute)`,
    );
  },
  unreachable: (names) =>
    both(
      `Not reachable (off or wrong address), asked again at every refresh: ${list(names)}.`,
      `Injoignables (éteints ou mauvaise adresse), redemandés à chaque rafraîchissement : ${list(names)}.`,
    ),
  noAnswerAt: (addresses) =>
    both(
      `No Kaleidescape movie player identified yet at: ${list(addresses)} (tried again every minute).`,
      `Aucun lecteur de films Kaleidescape identifié encore à : ${list(addresses)} (nouvel essai chaque minute).`,
    ),
  serverOnly: (addresses) =>
    both(
      `Kaleidescape servers without a movie zone, ignored: ${list(addresses)}.`,
      `Serveurs Kaleidescape sans zone de film, ignorés : ${list(addresses)}.`,
    ),
  addressUnknown: (names) =>
    both(
      `Address unknown (another player answers at the old one): ${list(names)}. Type the new address in the configuration.`,
      `Adresse inconnue (un autre lecteur répond à l'ancienne) : ${list(names)}. Saisissez la nouvelle adresse dans la configuration.`,
    ),
  invalidEntries: (entries) =>
    both(
      `Ignored in the configuration (invalid): ${list(entries)}.`,
      `Ignorés dans la configuration (invalides) : ${list(entries)}.`,
    ),
  dataReset: both(
    'The saved player list was unreadable and was reset; the players are found again from their addresses.',
    'La liste enregistrée des lecteurs était illisible et a été réinitialisée ; les lecteurs sont retrouvés par leurs adresses.',
  ),
};
