/* eslint-disable no-console */
import Database, { Statement } from 'better-sqlite3';
import { app, ipcMain } from 'electron';
import * as logging from './logging';
import path from 'path';
import { isOneDimensionalArray } from '../utils/util';

const dbPath = path.join(app.getPath('userData'), '5ire.db');
const database = new Database(dbPath);

function createTableChats() {
  database
    .prepare(
      `
  CREATE TABLE IF NOT EXISTS "chats" (
    "id" text(31) NOT NULL,
    "summary" text,
    "model" text,
    "systemMessage" text,
    "temperature" real,
    "maxTokens" integer,
    "stream" integer(1) DEFAULT 1,
    "context" text,
    "maxCtxMessages" integer DEFAULT 5,
    "createdAt" integer,
    PRIMARY KEY ("id")
  )`
    )
    .run();
}

function createTableMessages() {
  database
    .prepare(
      `CREATE TABLE IF NOT EXISTS "messages" (
      "id" text(31) NOT NULL,
      "prompt" TEXT COLLATE NOCASE,
      "reply" TEXT COLLATE NOCASE,
      "inputTokens" integer,
      "outputTokens" integer,
      "chatId" real(31),
      "temperature" real,
      "model" text,
      "memo" text,
      "createdAt" integer,
      "isActive" integer(1),
      "citedFiles"	TEXT,
      "citedChunks"	TEXT,
      "maxTokens" INTEGER,
      "toolCalls" TEXT,
      PRIMARY KEY ("id"),
      CONSTRAINT "fk_messages_chats" FOREIGN KEY ("chatId") REFERENCES "chats" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )`
    )
    .run();
}

function createTableBookmarks() {
  database
    .prepare(
      `CREATE TABLE IF NOT EXISTS "bookmarks" (
    "id" text(31) NOT NULL,
    "msgId" text NOT NULL,
    "prompt" TEXT,
    "reply" TEXT,
    "temperature" real,
    "model" text,
    "memo" text,
    "favorite" integer(1) DEFAULT 0,
    "citedFiles"	TEXT,
    "citedChunks"	TEXT,
    "createdAt" integer,
    PRIMARY KEY ("id"),
    CONSTRAINT "uix_msg_id" UNIQUE ("msgId" COLLATE BINARY ASC)
  )`
    )
    .run();
}

function createTablePrompts() {
  database
    .prepare(
      `CREATE TABLE IF NOT EXISTS "prompts" (
    "id" text(31) NOT NULL,
    "name" text,
    "systemMessage" TEXT,
    "userMessage" text,
    "systemVariables" text,
    "userVariables" text,
    "models" text,
    "temperature" real,
    "maxTokens" integer,
    "createdAt" integer,
    "updatedAt" integer,
    "pinedAt" integer DEFAULT NULL,
    PRIMARY KEY ("id")
  )`
    )
    .run();
}

function createTableUsages() {
  database
    .prepare(
      `CREATE TABLE IF NOT EXISTS "usages" (
    "id" text(31),
    "provider" text,
    "model" text,
    "InputTokens" integer,
    "outputTokens" integer,
    "inputPrice" number,
    "outputPrice" NUMBER,
    "createdAt" integer,
    PRIMARY KEY ("id")
  )`
    )
    .run();
}

function createTableKnowledgeCollections() {
  database
    .prepare(
      `CREATE TABLE IF NOT EXISTS "knowledge_collections" (
     "id" text(31) NOT NULL,
     "name" varchar NOT NULL,
     "memo" text,
     "pinedAt" integer,
     "favorite" integer(1),
     "createdAt" integer NOT NULL,
     "updatedAt" integer NOT NULL,
     PRIMARY KEY (id));`
    )
    .run();
}

function createTableKnowledgeFiles() {
  database
    .prepare(
      `CREATE TABLE IF NOT EXISTS "knowledge_files" (
    "id" text(31) NOT NULL,
    "collectionId" text(31) NOT NULL,
    "name" varchar NOT NULL,
    "size" integer,
    "numOfChunks" integer,
    "createdAt" integer NOT NULL,
    "updatedAt" integer NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (collectionId)
        REFERENCES knowledge_collections(id)
        ON DELETE CASCADE
    );`
    )
    .run();
}

function createTableChatKnowledgeRels() {
  database
    .prepare(
      `CREATE TABLE IF NOT EXISTS "chat_knowledge_rels" (
	"id" text NOT NULL,
	"chatId" text NOT NULL,
	"collectionId" text NOT NULL,
	FOREIGN KEY("chatId") REFERENCES "chats"("id") ON DELETE CASCADE,
	FOREIGN KEY("collectionId") REFERENCES "knowledge_collections"("id") ON DELETE CASCADE,
	PRIMARY KEY (id)
)`
    )
    .run();
}

function migrateMessagesTable() {
  // Check if toolCalls column exists
  const tableInfo = database.prepare("PRAGMA table_info(messages)").all();
  const hasToolCalls = tableInfo.some((column: any) => column.name === 'toolCalls');
  
  if (!hasToolCalls) {
    logging.info('Adding toolCalls column to messages table...');
    database.prepare('ALTER TABLE messages ADD COLUMN "toolCalls" TEXT').run();
    logging.info('Successfully added toolCalls column');
  }
}

const initDatabase = database.transaction(() => {
  logging.debug('Init database...');

  database.pragma('foreign_keys = ON');
  createTableChats();
  createTableMessages();
  createTableBookmarks();
  createTablePrompts();
  createTableUsages();
  createTableKnowledgeCollections();
  createTableKnowledgeFiles();
  createTableChatKnowledgeRels();
  migrateMessagesTable();
  logging.info('Database initialized.');
});

database.pragma('journal_mode = WAL'); // performance reason
initDatabase();

ipcMain.handle('db-all', (event, data) => {
  const { sql, params } = data;
  logging.debug('db-all', sql, params);
  try {
    return database.prepare(sql).all(params);
  } catch (err: any) {
    logging.captureException(err);
  }
});

ipcMain.handle('db-run', (_, data) => {
  const { sql, params } = data;
  logging.debug('db-run', sql, params);
  try {
    database.prepare(sql).run(params);
    return true;
  } catch (err: any) {
    logging.captureException(err);
    return false;
  }
});

ipcMain.handle('db-transaction', (_, data: any[]) => {
  logging.debug('db-transaction', JSON.stringify(data, null, 2));
  const tasks: { statement: Statement; params: any[] }[] = [];
  for (const { sql, params } of data) {
    tasks.push({
      statement: database.prepare(sql),
      params,
    });
  }
  return new Promise((resolve) => {
    try {
      database.transaction(() => {
        for (const { statement, params } of tasks) {
          if (isOneDimensionalArray(params)) {
            statement.run(params);
          } else {
            for (const param of params) {
              statement.run(param);
            }
          }
        }
      })();
      resolve(true);
    } catch (err: any) {
      logging.captureException(err);
      resolve(false);
    }
  });
});

ipcMain.handle('db-get', (_, data) => {
  const { sql, id } = data;
  logging.debug('db-get', sql, id);
  try {
    return database.prepare(sql).get(id);
  } catch (err: any) {
    logging.captureException(err);
  }
});
