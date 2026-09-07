import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { GameState } from '../src/engine/types';

/** A room as it survives a restart. Sockets are deliberately absent — they
 *  cannot be persisted, and a player is identified by their token instead. */
export interface StoredRoom {
  code: string;
  seats: { playerId: string; token: string; name: string }[];
  state: GameState | null;
  started: boolean;
  updatedAt: number;
}

export interface Store {
  load(): Promise<StoredRoom[]>;
  save(room: StoredRoom): Promise<void>;
  remove(code: string): Promise<void>;
}

/** Keeps rooms only for the life of the process. Fine for local runs and
 *  tests; on a real deploy a restart would lose every game in progress. */
export class MemoryStore implements Store {
  rooms = new Map<string, StoredRoom>();

  async load(): Promise<StoredRoom[]> {
    return [...this.rooms.values()];
  }

  async save(room: StoredRoom): Promise<void> {
    this.rooms.set(room.code, structuredClone(room));
  }

  async remove(code: string): Promise<void> {
    this.rooms.delete(code);
  }
}

/** File-backed store: one small JSON document per room.
 *
 *  This is deliberately boring. Game state is a few tens of KB and changes a
 *  few hundred times per game, so a file write per action is nothing. Swap in
 *  Postgres (a `rooms(code text primary key, state jsonb)` table) when you
 *  want rooms to survive the container's disk as well as its process — on
 *  Railway that matters, because the filesystem is ephemeral across deploys. */
export class FileStore implements Store {
  private writes = new Map<string, Promise<void>>();
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async load(): Promise<StoredRoom[]> {
    await mkdir(this.dir, { recursive: true });
    const files = await readdir(this.dir);
    const rooms: StoredRoom[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        rooms.push(JSON.parse(await readFile(join(this.dir, file), 'utf8')));
      } catch {
        // A half-written file from a hard kill: drop it rather than crash.
      }
    }
    return rooms;
  }

  save(room: StoredRoom): Promise<void> {
    // Serialise writes per room so two rapid actions cannot interleave.
    const previous = this.writes.get(room.code) ?? Promise.resolve();
    const next = previous.then(() => this.write(room)).catch((error) => {
      console.error(`[store] failed to save ${room.code}:`, error);
    });
    this.writes.set(room.code, next);
    return next;
  }

  private async write(room: StoredRoom): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const target = join(this.dir, `${room.code}.json`);
    const temporary = `${target}.tmp`;
    // Write then rename, so a crash mid-write cannot corrupt the live file.
    await writeFile(temporary, JSON.stringify(room), 'utf8');
    await rename(temporary, target);
  }

  async remove(code: string): Promise<void> {
    await unlink(join(this.dir, `${code}.json`)).catch(() => {});
  }
}
