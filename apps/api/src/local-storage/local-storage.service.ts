import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

type AnyRecord = Record<string, any>;

interface LocalDatabase {
  canvases: AnyRecord[];
  chat_sessions: AnyRecord[];
  chat_messages: AnyRecord[];
}

const EMPTY_DB: LocalDatabase = {
  canvases: [],
  chat_sessions: [],
  chat_messages: [],
};

@Injectable()
export class LocalStorageService {
  private readonly dataDir: string;
  private readonly dbPath: string;

  constructor(private readonly configService: ConfigService) {
    this.dataDir = path.resolve(
      process.cwd(),
      this.configService.get<string>('NOLANX_LOCAL_DATA_DIR') || 'data',
    );
    this.dbPath = path.join(this.dataDir, 'nolanx-db.json');
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.ensureDb();
  }

  getDataDir(): string {
    return this.dataDir;
  }

  private ensureDb() {
    if (!fs.existsSync(this.dbPath)) {
      this.writeDb(EMPTY_DB);
    }
  }

  private readDb(): LocalDatabase {
    this.ensureDb();
    try {
      const parsed = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
      return {
        canvases: Array.isArray(parsed.canvases) ? parsed.canvases : [],
        chat_sessions: Array.isArray(parsed.chat_sessions) ? parsed.chat_sessions : [],
        chat_messages: Array.isArray(parsed.chat_messages) ? parsed.chat_messages : [],
      };
    } catch {
      return { ...EMPTY_DB };
    }
  }

  private writeDb(db: LocalDatabase) {
    fs.writeFileSync(this.dbPath, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
  }

  list(table: keyof LocalDatabase): AnyRecord[] {
    return [...this.readDb()[table]];
  }

  findById(table: keyof LocalDatabase, id: string): AnyRecord | null {
    return this.readDb()[table].find((row) => row.id === id) || null;
  }

  findMany(table: keyof LocalDatabase, predicate: (row: AnyRecord) => boolean): AnyRecord[] {
    return this.readDb()[table].filter(predicate);
  }

  upsert(table: keyof LocalDatabase, row: AnyRecord): AnyRecord {
    const db = this.readDb();
    const now = new Date().toISOString();
    const item = {
      ...row,
      id: row.id || randomUUID(),
      created_at: row.created_at || now,
      updated_at: now,
    };
    const index = db[table].findIndex((existing) => existing.id === item.id);
    if (index >= 0) {
      db[table][index] = { ...db[table][index], ...item };
    } else {
      db[table].push(item);
    }
    this.writeDb(db);
    return item;
  }

  update(table: keyof LocalDatabase, id: string, updates: AnyRecord): AnyRecord | null {
    const db = this.readDb();
    const index = db[table].findIndex((row) => row.id === id);
    if (index < 0) return null;
    db[table][index] = {
      ...db[table][index],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.writeDb(db);
    return db[table][index];
  }

  delete(table: keyof LocalDatabase, id: string): boolean {
    const db = this.readDb();
    const before = db[table].length;
    db[table] = db[table].filter((row) => row.id !== id) as any;
    this.writeDb(db);
    return db[table].length !== before;
  }
}
