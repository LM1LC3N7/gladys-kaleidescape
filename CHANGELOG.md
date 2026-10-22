# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Kaleidescape movie players over their local control protocol (TCP 10000),
  without any cloud: added by IP address, identified by their serial number;
  servers without a movie zone are not offered.
- Power state (read only) and power status (On, Standby, Not reachable),
  "Power on", "Standby", "Play", "Pause" and "Stop" buttons (no switch), a
  remote key dropdown (arrows, OK, Back, menu, chapters...), playing state,
  play status, title, chapter, movie location (content, intermission,
  credits), video mode and dynamic range.
- Commands decided on the state read just before, sent only before their
  deadline and confirmed only by a value read back ("sent, without
  confirmation" otherwise, "nothing sent" when nothing left); Standby, Pause
  and Stop are never queued nor blocked, and cancel the commands waiting.
- Reads never sooner than the refresh interval (15 s by default), even
  after a reconnection, a configuration save, the check button or a restart;
  "Check the players" button.

### Fixed

- Standby, Pause or Stop pressed right after a Power on or Play that the
  player had not applied yet is now sent, never answered "already done";
  the same the other way round.
- Play during a fast forward or rewind is sent.
- Pressing the same Standby, Pause or Stop many times joins one command;
  at most 4 commands wait per player, the next ones are refused at once.
- An address removed then typed again is not read sooner than its interval;
  a failing Gladys device list is asked again spaced, and the players follow
  its return; a full player list makes room for a new player.

### Security

- Answers bounded (2 KB per line, 256 KB per session, 32 fields of 512
  characters) and parsed linearly; an answer is taken only with its
  expected name and sequence number; values mapped through tables without
  prototype; only serial numbers are keys in `/data`, nothing of what plays
  is stored.

[Unreleased]: https://github.com/LM1LC3N7/gladys-kaleidescape/commits/main
