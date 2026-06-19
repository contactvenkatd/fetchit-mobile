import { supabase } from './supabase';

/**
 * Chat history — the shared Supabase `chats` table (same backend as the web app).
 * Rows: { id, user_id, title, messages (jsonb), created_at }. Row-Level Security
 * scopes every query to the signed-in user, so we don't filter by user_id here —
 * this mirrors the web app's `getChats` in fetchit-app/src/utils.js.
 */

export type StoredMessage = { role: 'user' | 'assistant'; text: string };

export type Chat = {
  id: string;
  title: string;
  createdAt: string;
  messages: StoredMessage[];
};

// The web app stores messages as jsonb; normalize each row to the mobile shape.
// Tolerate either `text` or `content` on stored messages so older rows still load.
function mapChat(row: any): Chat {
  const raw = Array.isArray(row?.messages) ? row.messages : [];
  const messages: StoredMessage[] = raw.map((m: any) => ({
    role: m?.role === 'assistant' ? 'assistant' : 'user',
    text:
      typeof m?.text === 'string'
        ? m.text
        : typeof m?.content === 'string'
          ? m.content
          : '',
  }));
  return {
    id: String(row?.id),
    title: row?.title || 'Untitled chat',
    createdAt: row?.created_at ?? '',
    messages,
  };
}

/** Most-recent-first list of the current user's past conversations. */
export async function getChats(): Promise<Chat[]> {
  const { data, error } = await supabase
    .from('chats')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('getChats failed:', error.message);
    return [];
  }
  return (data ?? []).map(mapChat);
}
