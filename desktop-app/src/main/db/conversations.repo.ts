import { randomUUID } from "crypto";
import type { ChatMessage, Conversation } from "@shared/types";
import { getDb } from "../db/database";

/** Konversations-Persistenz in SQLite. Nachrichten werden als JSON-Blob abgelegt. */

export function listConversations(): Array<{
  id: string;
  name: string;
  updatedAt: string;
}> {
  return getDb()
    .prepare(
      "SELECT id, name, updated_at as updatedAt FROM conversations ORDER BY updated_at DESC",
    )
    .all() as Array<{ id: string; name: string; updatedAt: string }>;
}

export function loadConversation(id: string): Conversation | null {
  const row = getDb()
    .prepare(
      "SELECT id, name, created_at, updated_at, data FROM conversations WHERE id = ?",
    )
    .get(id) as
    | {
        id: string;
        name: string;
        created_at: string;
        updated_at: string;
        data: string;
      }
    | undefined;
  if (!row) return null;
  let messages: ChatMessage[];
  try {
    messages = JSON.parse(row.data) as ChatMessage[];
  } catch {
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages,
  };
}

export function saveConversation(conversation: Conversation): void {
  const now = new Date().toISOString();
  const id = conversation.id || randomUUID();
  getDb()
    .prepare(
      `INSERT INTO conversations (id, name, created_at, updated_at, data)
       VALUES (@id, @name, @createdAt, @updatedAt, @data)
       ON CONFLICT(id) DO UPDATE SET
         name = @name, updated_at = @updatedAt, data = @data`,
    )
    .run({
      id,
      name: conversation.name,
      createdAt: conversation.createdAt || now,
      updatedAt: now,
      data: JSON.stringify(conversation.messages),
    });
}

export function deleteConversation(id: string): void {
  getDb().prepare("DELETE FROM conversations WHERE id = ?").run(id);
}
