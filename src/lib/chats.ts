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

/** Create a FetchIt chat. `user_id` is supplied by the database default/RLS. */
export async function createChat(
  title: string,
  messages: StoredMessage[],
): Promise<Chat> {
  const { data, error } = await supabase
    .from('chats')
    .insert({ title, messages, app_source: 'fetchit' })
    .select('id, title, messages, created_at')
    .single();
  if (error) throw new Error(`createChat failed: ${error.message}`);
  return mapChat(data);
}

/** Replace the JSON message transcript for an existing RLS-scoped chat. */
export async function updateChatMessages(
  chatId: string,
  messages: StoredMessage[],
): Promise<void> {
  const { error } = await supabase
    .from('chats')
    .update({ messages })
    .eq('id', chatId);
  if (error) throw new Error(`updateChatMessages failed: ${error.message}`);
}

/** Delete one chat by ID; ownership is enforced by the table's RLS policy. */
export async function deleteChat(chatId: string): Promise<void> {
  const { error } = await supabase.from('chats').delete().eq('id', chatId);
  if (error) throw new Error(`deleteChat failed: ${error.message}`);
}
