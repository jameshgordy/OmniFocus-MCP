import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, Server, Socket } from 'net';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PassThrough, Writable } from 'stream';
import { obtainConnection, runShim, tryConnect } from './shim.js';
import { tryAcquireLock } from './lock.js';
import { resolveLockDir } from './socketPath.js';

describe('tryConnect', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'of-shim-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns null when nothing is listening', async () => {
    await expect(tryConnect(join(dir, 'absent.sock'))).resolves.toBeNull();
  });

  it('returns a socket when a daemon is listening', async () => {
    const path = join(dir, 'live.sock');
    const server = createServer();
    await new Promise<void>((r) => server.listen(path, r));
    try {
      const socket = await tryConnect(path);
      expect(socket).not.toBeNull();
      socket!.destroy();
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe('obtainConnection', () => {
  let dir: string;
  let socketPath: string;
  let server: Server | undefined;

  const listen = async (): Promise<void> => {
    server = createServer();
    await new Promise<void>((r) => server!.listen(socketPath, r));
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'of-shim-'));
    socketPath = join(dir, 'daemon.sock');
  });

  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  it('connects to a running daemon without spawning another', async () => {
    await listen();
    const spawnDaemon = vi.fn();

    const socket = await obtainConnection(socketPath, spawnDaemon, 1000);

    expect(socket).not.toBeNull();
    expect(spawnDaemon).not.toHaveBeenCalled();
    socket!.destroy();
  });

  it('spawns a daemon when none is running, then connects to it', async () => {
    const spawnDaemon = vi.fn(() => {
      // Stand in for the real detached daemon coming up asynchronously.
      setTimeout(() => void listen(), 30);
    });

    const socket = await obtainConnection(socketPath, spawnDaemon, 5000);

    expect(spawnDaemon).toHaveBeenCalledOnce();
    expect(socket).not.toBeNull();
    socket!.destroy();
  });

  it('waits instead of spawning when another starter holds the lock', async () => {
    // The thundering-herd guard. Ten agents launching at once is this project's
    // normal load; nine of them must recognise a daemon is already on its way
    // rather than each starting one.
    const held = tryAcquireLock(resolveLockDir(socketPath));
    expect(held).not.toBeNull();

    const spawnDaemon = vi.fn();
    setTimeout(() => void listen(), 30);

    const socket = await obtainConnection(socketPath, spawnDaemon, 5000);

    expect(spawnDaemon).not.toHaveBeenCalled();
    expect(socket).not.toBeNull();
    socket!.destroy();
    held!.release();
  });

  it('gives up after the start deadline so the caller can fall back', async () => {
    const spawnDaemon = vi.fn(); // spawns nothing; the daemon never appears
    const socket = await obtainConnection(socketPath, spawnDaemon, 150);
    expect(socket).toBeNull();
  });

  it('reports failure rather than throwing when the spawn itself fails', async () => {
    // A sandbox that forbids spawning must degrade to the standalone server, not
    // crash the client's MCP launch.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const spawnDaemon = vi.fn(() => {
      throw new Error('spawn forbidden');
    });

    const socket = await obtainConnection(socketPath, spawnDaemon, 150);

    expect(socket).toBeNull();
    spy.mockRestore();
  });

  it('releases the lock when the spawn fails, so a retry can try again', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await obtainConnection(
      socketPath,
      () => {
        throw new Error('spawn forbidden');
      },
      100
    );
    spy.mockRestore();

    const lock = tryAcquireLock(resolveLockDir(socketPath));
    expect(lock).not.toBeNull();
    lock!.release();
  });
});

/**
 * A stand-in daemon: one JSON-RPC "session" per connection that answers every
 * request with an empty result and records what each connection received.
 */
function fakeDaemon(socketPath: string): { server: Server; sessions: FakeSession[]; close: () => Promise<void> } {
  const sessions: FakeSession[] = [];
  const server = createServer((socket) => {
    const sess: FakeSession = { received: [], closed: false };
    sessions.push(sess);
    let buf = '';
    socket.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      let idx: number;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line) as { id?: number; method?: string };
        sess.received.push(msg);
        if (msg.id !== undefined) {
          socket.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) + '\n');
        }
      }
    });
    socket.on('close', () => {
      sess.closed = true;
    });
  });
  return {
    server,
    sessions,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
interface FakeSession {
  received: Array<{ id?: number; method?: string }>;
  closed: boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms = 2000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await sleep(10);
  }
};

describe('runShim idle backstop', () => {
  // Claude Desktop launches the shim once and keeps it for the life of the app.
  // If the shim exits after a quiet half hour, Desktop reports the server as
  // disconnected and never relaunches it: OmniFocus is gone until the app
  // restarts. The backstop must therefore *park* the daemon session, not exit.
  let dir: string;
  let socketPath: string;
  let daemon: ReturnType<typeof fakeDaemon>;
  let input: PassThrough;
  let outLines: string[];
  let output: Writable;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  const IDLE_MINUTES = 0.002; // 120 ms

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'of-shim-'));
    socketPath = join(dir, 'daemon.sock');
    daemon = fakeDaemon(socketPath);
    await new Promise<void>((r) => daemon.server.listen(socketPath, r));
    input = new PassThrough();
    outLines = [];
    let outBuf = '';
    output = new Writable({
      write(chunk, _enc, cb) {
        outBuf += chunk.toString('utf8');
        let idx: number;
        while ((idx = outBuf.indexOf('\n')) !== -1) {
          outLines.push(outBuf.slice(0, idx));
          outBuf = outBuf.slice(idx + 1);
        }
        cb();
      },
    });
    // Record rather than throw: exit() is reached from timers and socket events,
    // where a throw would surface as an unhandled error instead of a failed assert.
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    // Close the client side while exit is still mocked: a parked shim exits on EOF.
    input.end();
    await sleep(20);
    exitSpy.mockRestore();
    errSpy.mockRestore();
    await daemon.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const send = (msg: object): void => {
    input.write(JSON.stringify(msg) + '\n');
  };
  const responses = (): Array<{ id?: number; result?: unknown; error?: { message: string } }> =>
    outLines.map((l) => JSON.parse(l));

  it('parks the daemon session when idle and rebuilds it on the next request', async () => {
    await runShim({ socketPath, spawnDaemon: vi.fn(), idleTimeoutMinutes: IDLE_MINUTES, input, output });

    send({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    await until(() => responses().some((r) => r.id === 0));

    // Go quiet for longer than the idle timeout: the daemon side closes...
    await until(() => daemon.sessions[0].closed, 1000);
    // ...but the shim is still alive and the client never saw an exit.
    expect(exitSpy).not.toHaveBeenCalled();
    expect(daemon.sessions).toHaveLength(1);

    // A request after the quiet spell gets a fresh session, handshake replayed
    // ahead of it, and is answered.
    send({ jsonrpc: '2.0', id: 7, method: 'tools/list' });
    await until(() => responses().some((r) => r.id === 7));

    expect(daemon.sessions).toHaveLength(2);
    expect(daemon.sessions[1].received.map((m) => m.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
    ]);
    expect(responses().find((r) => r.id === 7)).toMatchObject({ result: {} });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('parks and wakes repeatedly across many quiet spells', async () => {
    await runShim({ socketPath, spawnDaemon: vi.fn(), idleTimeoutMinutes: IDLE_MINUTES, input, output });
    send({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} });
    await until(() => responses().some((r) => r.id === 0));

    for (let i = 1; i <= 3; i++) {
      await until(() => daemon.sessions[daemon.sessions.length - 1].closed, 1000);
      send({ jsonrpc: '2.0', id: i, method: 'tools/list' });
      await until(() => responses().some((r) => r.id === i));
    }
    expect(daemon.sessions).toHaveLength(4);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('fails a request that was still unanswered when the session parked, instead of hanging it', async () => {
    // Make the daemon swallow one request so it stays pending across the park.
    daemon.server.removeAllListeners('connection');
    daemon.server.on('connection', (socket: Socket) => {
      socket.on('data', (chunk: Buffer) => {
        const msg = JSON.parse(chunk.toString('utf8').trim().split('\n')[0]) as { id?: number; method?: string };
        if (msg.method === 'initialize') {
          socket.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) + '\n');
        }
        // anything else: never answered
      });
    });
    await runShim({ socketPath, spawnDaemon: vi.fn(), idleTimeoutMinutes: IDLE_MINUTES, input, output });
    send({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} });
    await until(() => responses().some((r) => r.id === 0));
    send({ jsonrpc: '2.0', id: 3, method: 'tools/list' });

    await until(() => responses().some((r) => r.id === 3), 1000);
    expect(responses().find((r) => r.id === 3)?.error?.message).toMatch(/idle/);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('still exits on idle if the client never completed a handshake', async () => {
    // Nothing to resume, and a client that launched us and then said nothing for
    // the whole timeout is far more likely dead than quiet.
    await runShim({ socketPath, spawnDaemon: vi.fn(), idleTimeoutMinutes: IDLE_MINUTES, input, output });
    await until(() => exitSpy.mock.calls.length > 0, 1000).catch(() => {});
    expect(exitSpy).toHaveBeenCalled();
  });
});
