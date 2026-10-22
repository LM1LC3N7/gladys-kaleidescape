// -----------------------------------------------------------------------------
// One TCP session with a Kaleidescape player: connection, then requests sent
// one at a time, each answered by a line carrying its sequence number.
// Events (`!`) and late answers to an earlier request are read and dropped.
// Ported from pykaleidescape 1.2.0 (MIT, kaleidescape/connection.py), see
// THIRD_PARTY_NOTICES.md.
//
// Untrusted input: a line is at most 2 KB (more: the session is closed), and
// a session reads at most 256 KB in all (a flood of events closes it). Each
// chunk is scanned once; each line is decoded once, never kept.
// -----------------------------------------------------------------------------

import net from 'node:net';
import { ANSWERS, LOCAL_CPDID, STATUS, parseLine, requestLine } from './protocol.js';

export const ERROR_KINDS = Object.freeze({
  /** Nothing connected: refused, no route, no answer to the TCP connection. */
  UNREACHABLE: 'unreachable',
  /** Connected, then no answer in time. */
  TIMEOUT: 'timeout',
  /** Unexpected bytes, too much data. */
  PROTOCOL: 'protocol',
  /** The player answered the request with an error status. */
  REFUSED: 'refused',
  /** No time left in the budget of the caller (nothing sent). */
  BUDGET: 'budget',
  /** The connection closed under a request. */
  CLOSED: 'closed',
});

export class KaleidescapeError extends Error {
  /** `sent`: the request line left, it may have reached the player. */
  constructor(kind, message, { sent = false, status } = {}) {
    super(message);
    this.name = 'KaleidescapeError';
    this.kind = kind;
    this.sent = sent;
    this.status = status;
  }
}

const MAX_LINE = 2048;
const MAX_SESSION_BYTES = 256 * 1024;

export class Session {
  constructor(socket, { readTimeout, deadline, now = Date.now }) {
    this.socket = socket;
    this.readTimeout = readTimeout;
    this.deadline = deadline;
    this.now = now;
    this.partial = Buffer.alloc(MAX_LINE);
    this.buffered = 0;
    this.total = 0;
    this.pending = undefined;
    this.closed = false;
    this.failure = undefined;
    this.nextSeq = 0;
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', () => this.onClose());
    socket.on('close', () => this.onClose());
    if (socket.destroyed) {
      this.onClose();
    }
  }

  onData(chunk) {
    if (this.closed) {
      return;
    }
    this.total += chunk.length;
    if (this.total > MAX_SESSION_BYTES) {
      this.fail(new KaleidescapeError(ERROR_KINDS.PROTOCOL, 'Too much data from the player'));
      return;
    }
    // Split on line feeds as the bytes come: each chunk is scanned once; the
    // start of a line cut between chunks goes to one fixed 2 KB buffer.
    let start = 0;
    let index;
    while ((index = chunk.indexOf(0x0a, start)) !== -1) {
      const part = chunk.subarray(start, index);
      if (this.buffered + part.length > MAX_LINE) {
        this.fail(new KaleidescapeError(ERROR_KINDS.PROTOCOL, 'Line too long from the player'));
        return;
      }
      let text;
      if (this.buffered === 0) {
        text = part.toString('latin1');
      } else {
        part.copy(this.partial, this.buffered);
        text = this.partial.toString('latin1', 0, this.buffered + part.length);
        this.buffered = 0;
      }
      this.onLine(text.replace(/\r$/, ''));
      if (this.closed) {
        return;
      }
      start = index + 1;
    }
    const rest = chunk.subarray(start);
    if (rest.length > 0) {
      if (this.buffered + rest.length > MAX_LINE) {
        this.fail(new KaleidescapeError(ERROR_KINDS.PROTOCOL, 'Line too long from the player'));
        return;
      }
      rest.copy(this.partial, this.buffered);
      this.buffered += rest.length;
    }
  }

  onLine(text) {
    const pending = this.pending;
    if (!pending || text === '') {
      return;
    }
    const message = parseLine(text);
    // Events, other devices, late answers to an earlier request, and a line
    // of the right sequence but another name (a forged or shifted answer):
    // dropped. An error status carries its error text as name.
    if (
      !message ||
      message.seq !== pending.seq ||
      message.deviceId !== LOCAL_CPDID ||
      (message.status === STATUS.SUCCESS && message.name !== pending.expect)
    ) {
      return;
    }
    this.pending = undefined;
    clearTimeout(pending.timer);
    pending.resolve(message);
  }

  onClose() {
    if (!this.closed) {
      this.fail(new KaleidescapeError(ERROR_KINDS.CLOSED, 'The player closed the connection'));
    }
  }

  fail(err) {
    this.failure = this.failure ?? err;
    this.close();
    const pending = this.pending;
    this.pending = undefined;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(this.failure);
    }
  }

  close() {
    if (!this.closed) {
      this.closed = true;
      this.socket.destroy();
    }
  }

  /** What is left before `until` (the deadline by default), capped by the read timeout. */
  left(until = this.deadline) {
    return Math.min(this.readTimeout, Math.min(until, this.deadline) - this.now());
  }

  /**
   * Sends `name` and resolves its answer { status, name, fields }. An error
   * status rejects with REFUSED (with `status`). `beforeWrite`, when given,
   * runs just before the line leaves and may throw to send nothing (the
   * deadline or a cancellation checked at the last moment). From the write
   * on, every error is `sent` when `command` is true.
   */
  async request(name, { until = this.deadline, command = false, beforeWrite } = {}) {
    if (this.failure) {
      throw this.failure;
    }
    const timeout = this.left(until);
    if (timeout <= 0) {
      throw new KaleidescapeError(ERROR_KINDS.BUDGET, `No time left for ${name}, nothing sent`);
    }
    beforeWrite?.();
    const seq = this.nextSeq;
    this.nextSeq = (this.nextSeq + 1) % 10;
    const answer = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // An answer that did not come leaves the line out of step: the
        // session is never reused.
        this.fail(new KaleidescapeError(ERROR_KINDS.TIMEOUT, `No answer to ${name} in time`));
      }, timeout);
      // A GET_ request is answered by its own name, a command by an
      // acknowledgement without name.
      const expect = Object.hasOwn(ANSWERS, name) ? ANSWERS[name] : '';
      this.pending = { seq, expect, resolve, reject, timer };
    });
    try {
      this.socket.write(requestLine(seq, name));
      const message = await answer;
      if (message.status !== STATUS.SUCCESS) {
        throw new KaleidescapeError(
          ERROR_KINDS.REFUSED,
          `${name} refused by the player (status ${message.status})`,
          { status: message.status },
        );
      }
      return message;
    } catch (err) {
      // A refusal is an answer: the player got the request and did nothing.
      if (command && err.kind !== ERROR_KINDS.REFUSED) {
        throw new KaleidescapeError(err.kind ?? ERROR_KINDS.PROTOCOL, err.message, {
          sent: true,
          status: err.status,
        });
      }
      throw err;
    }
  }
}

function connect({ host, port, timeout, createConnection }) {
  return new Promise((resolve, reject) => {
    if (timeout <= 0) {
      reject(new KaleidescapeError(ERROR_KINDS.BUDGET, 'No time left to connect, nothing sent'));
      return;
    }
    const socket = createConnection({ host, port });
    socket.setNoDelay?.(true);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new KaleidescapeError(ERROR_KINDS.UNREACHABLE, `No answer from ${host}:${port}`));
    }, timeout);
    const onError = (err) => {
      clearTimeout(timer);
      socket.destroy();
      reject(
        new KaleidescapeError(
          ERROR_KINDS.UNREACHABLE,
          `Cannot connect to ${host}:${port} (${err.code ?? 'error'})`,
        ),
      );
    };
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.off('error', onError);
      // Until the session listens: an error is never left unhandled.
      socket.on('error', () => {});
      resolve(socket);
    });
    socket.once('error', onError);
  });
}

/** Opens a session with the player at host:port, before `deadline`. */
export async function openSession({
  host,
  port,
  deadline,
  connectTimeout,
  readTimeout,
  now = Date.now,
  createConnection = net.createConnection,
}) {
  const socket = await connect({
    host,
    port,
    timeout: Math.min(connectTimeout, deadline - now()),
    createConnection,
  });
  return new Session(socket, { readTimeout, deadline, now });
}
