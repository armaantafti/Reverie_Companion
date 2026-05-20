import type {
  AckStatus,
  BoardItemType,
  CaregiverLink,
  DailyBoardItem,
  EmergencyContact,
  LinkedCaregiver,
  Memory,
  MemoryType,
  ObjectLocation,
  PhotoCard,
  Profile,
  Reminder,
  ReminderCategory,
  SearchResult
} from './types';
import { db } from './lib/supabaseClient';

export function requireDb() {
  if (!db) {
    throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }
  return db;
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function inferMemoryType(text: string): MemoryType {
  const value = text.toLowerCase();
  if (/(kept|keep|where|drawer|cupboard|cabinet|shelf|sofa|table|locker|bag|box)/.test(value)) return 'where_kept';
  if (/(medicine|tablet|doctor|clinic|hospital|health|blood|pain)/.test(value)) return 'medical';
  if (/(routine|daily|every day|walk|breakfast|lunch|dinner)/.test(value)) return 'routine';
  if (/(son|daughter|wife|husband|doctor|caregiver|friend|person|photo)/.test(value)) return 'person';
  return 'general';
}

export function extractObjectLocation(text: string) {
  const normalized = text.trim();
  const keptMatch = normalized.match(/(?:kept|keep|put|placed)\s+(?:my\s+|the\s+)?(.+?)\s+(?:in|inside|on|near|at)\s+(.+)/i);
  const whereMatch = normalized.match(/(?:where\s+is|where\s+are)\s+(?:my\s+|the\s+)?(.+)/i);

  if (keptMatch) {
    return {
      object_name: keptMatch[1].replace(/[?.!]+$/, '').trim().slice(0, 80),
      location_text: keptMatch[2].replace(/[?.!]+$/, '').trim().slice(0, 240)
    };
  }

  if (whereMatch) {
    return {
      object_name: whereMatch[1].replace(/[?.!]+$/, '').trim().slice(0, 80),
      location_text: normalized.slice(0, 240)
    };
  }

  return null;
}

export async function getCurrentUser() {
  const client = requireDb();
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  return data.user;
}

export async function signIn(email: string, password: string) {
  const client = requireDb();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUp(email: string, password: string) {
  const client = requireDb();
  const { error } = await client.auth.signUp({ email, password });
  if (error) throw error;
}

export async function signOut() {
  const client = requireDb();
  await client.auth.signOut();
}

export async function loadOwnProfile(userId: string) {
  const client = requireDb();
  const { data, error } = await client
    .from('companion_profiles')
    .select('*')
    .eq('auth_user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

export async function createOwnProfile(userId: string, displayName: string) {
  const client = requireDb();
  const { data, error } = await client
    .from('companion_profiles')
    .insert({
      auth_user_id: userId,
      display_name: displayName.trim(),
      preferred_language: 'en-IN',
      voice_reply_enabled: true,
      large_text_enabled: true,
      high_contrast_enabled: false
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as Profile;
}

export async function updateProfile(profileId: string, patch: Partial<Profile>) {
  const client = requireDb();
  const { data, error } = await client
    .from('companion_profiles')
    .update(patch)
    .eq('id', profileId)
    .select('*')
    .single();
  if (error) throw error;
  return data as Profile;
}

export async function loadCaregiverLinks() {
  const client = requireDb();
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  const userId = authData.user?.id;
  if (!userId) return [];

  const { data, error } = await client
    .from('companion_caregiver_links')
    .select('*, companion_profiles(*)')
    .eq('caregiver_user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as CaregiverLink[];
}

export async function loadLinkedCaregivers(profileId: string) {
  const client = requireDb();
  const { data, error } = await client.rpc('companion_list_profile_caregivers', {
    target_profile_id: profileId
  });
  if (error) throw error;
  return (data || []) as LinkedCaregiver[];
}

export async function revokeCaregiverAccess(linkId: string) {
  const client = requireDb();
  const { error } = await client.rpc('companion_revoke_caregiver_link', {
    link_id_input: linkId
  });
  if (error) throw error;
}

export async function loadProfileData(profileId: string) {
  const client = requireDb();
  const [memories, objects, board, reminders, photos, contacts] = await Promise.all([
    client.from('companion_memories').select('*').eq('profile_id', profileId).order('created_at', { ascending: false }),
    client.from('companion_object_locations').select('*').eq('profile_id', profileId).order('last_confirmed_at', { ascending: false }),
    client.from('companion_daily_board_items').select('*').eq('profile_id', profileId).order('scheduled_time', { ascending: true }),
    client.from('companion_reminders').select('*').eq('profile_id', profileId).order('scheduled_date', { ascending: true }).order('scheduled_time', { ascending: true }),
    client.from('companion_photo_cards').select('*').eq('profile_id', profileId).order('name', { ascending: true }),
    client.from('companion_emergency_contacts').select('*').eq('profile_id', profileId).order('sort_order', { ascending: true })
  ]);

  for (const response of [memories, objects, board, reminders, photos, contacts]) {
    if (response.error) throw response.error;
  }

  const snapshot = {
    memories: (memories.data || []) as Memory[],
    objects: (objects.data || []) as ObjectLocation[],
    board: (board.data || []) as DailyBoardItem[],
    reminders: (reminders.data || []) as Reminder[],
    photos: (photos.data || []) as PhotoCard[],
    contacts: (contacts.data || []) as EmergencyContact[]
  };

  localStorage.setItem(`companion:last:${profileId}`, JSON.stringify(snapshot));
  return snapshot;
}

export function loadCachedProfileData(profileId: string) {
  const cached = localStorage.getItem(`companion:last:${profileId}`);
  return cached ? JSON.parse(cached) as Awaited<ReturnType<typeof loadProfileData>> : null;
}

export async function addMemory(profileId: string, userId: string, body: string) {
  const client = requireDb();
  const memoryType = inferMemoryType(body);
  const title = body.trim().slice(0, 56) || 'Saved memory';
  const { data, error } = await client
    .from('companion_memories')
    .insert({
      profile_id: profileId,
      title,
      body,
      memory_type: memoryType,
      source: 'user',
      created_by: userId
    })
    .select('*')
    .single();
  if (error) throw error;

  const objectLocation = extractObjectLocation(body);
  if (objectLocation) {
    await upsertObjectLocation(profileId, userId, objectLocation.object_name, objectLocation.location_text);
  }

  return data as Memory;
}

export async function upsertObjectLocation(profileId: string, userId: string, objectName: string, locationText: string, photoUrl?: string) {
  const client = requireDb();
  const { data: existing, error: lookupError } = await client
    .from('companion_object_locations')
    .select('*')
    .eq('profile_id', profileId)
    .ilike('object_name', objectName.trim())
    .maybeSingle();
  if (lookupError) throw lookupError;

  if (existing) {
    const { data, error } = await client
      .from('companion_object_locations')
      .update({
        location_text: locationText,
        photo_url: photoUrl || existing.photo_url,
        last_confirmed_at: new Date().toISOString()
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw error;
    return data as ObjectLocation;
  }

  const { data, error } = await client
    .from('companion_object_locations')
    .insert({
      profile_id: profileId,
      object_name: objectName.trim(),
      location_text: locationText.trim(),
      photo_url: photoUrl || null,
      created_by: userId
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as ObjectLocation;
}

export async function addDailyBoardItem(profileId: string, userId: string, label: string, detail: string, itemType: BoardItemType, scheduledTime?: string) {
  const client = requireDb();
  const { data, error } = await client
    .from('companion_daily_board_items')
    .insert({
      profile_id: profileId,
      board_date: todayIso(),
      label,
      detail,
      scheduled_time: scheduledTime || null,
      item_type: itemType,
      created_by: userId
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as DailyBoardItem;
}

export async function toggleBoardItem(id: string, completed: boolean) {
  const client = requireDb();
  const { error } = await client.from('companion_daily_board_items').update({ completed }).eq('id', id);
  if (error) throw error;
}

export async function addReminder(profileId: string, userId: string, payload: {
  title: string;
  detail: string;
  category: ReminderCategory;
  scheduled_date: string;
  scheduled_time: string;
  repeat_rule: string;
  escalation_minutes: number;
  caregiver_escalation_enabled: boolean;
}) {
  const client = requireDb();
  const { data, error } = await client
    .from('companion_reminders')
    .insert({ ...payload, profile_id: profileId, created_by: userId })
    .select('*')
    .single();
  if (error) throw error;
  return data as Reminder;
}

export async function acknowledgeReminder(reminder: Reminder, status: AckStatus) {
  const client = requireDb();
  const now = new Date().toISOString();
  const { error: ackError } = await client.from('companion_reminder_acknowledgements').insert({
    reminder_id: reminder.id,
    profile_id: reminder.profile_id,
    status,
    acknowledged_at: now
  });
  if (ackError) throw ackError;
  const { error } = await client
    .from('companion_reminders')
    .update({ last_acknowledged_at: now, last_acknowledgement_status: status })
    .eq('id', reminder.id);
  if (error) throw error;
}

export async function addPhotoCard(profileId: string, userId: string, name: string, relationship: string, note: string, imageUrl?: string) {
  const client = requireDb();
  const { data, error } = await client
    .from('companion_photo_cards')
    .insert({
      profile_id: profileId,
      name,
      relationship,
      note,
      image_url: imageUrl || null,
      created_by: userId
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as PhotoCard;
}

export async function addEmergencyContact(profileId: string, name: string, relationship: string, phone: string, sortOrder: number) {
  const client = requireDb();
  const { data, error } = await client
    .from('companion_emergency_contacts')
    .insert({
      profile_id: profileId,
      name,
      relationship,
      phone,
      sort_order: sortOrder
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as EmergencyContact;
}

export async function createCaregiverInvite(profileId: string) {
  const client = requireDb();
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await client
    .from('companion_caregiver_invites')
    .insert({ senior_profile_id: profileId, invite_code: code, expires_at: expires })
    .select('*')
    .single();
  if (error) throw error;
  return data as { invite_code: string; expires_at: string };
}

export async function acceptCaregiverInvite(inviteCode: string) {
  const client = requireDb();
  const code = inviteCode.trim().toUpperCase();
  if (!code) throw new Error('Enter a caregiver invite code.');

  const { data, error } = await client.rpc('companion_accept_caregiver_invite', {
    invite_code_input: code
  });
  if (error) throw error;
  return data as string;
}

export async function uploadCompanionPhoto(profileId: string, file: File) {
  const client = requireDb();
  const compressed = await compressImage(file);
  const ext = compressed.type.includes('png') ? 'png' : 'jpg';
  const path = `${profileId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await client.storage.from('companion-photos').upload(path, compressed, { upsert: false });
  if (error) throw error;
  const { data } = client.storage.from('companion-photos').getPublicUrl(path);
  return data.publicUrl;
}

async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  const bitmap = await createImageBitmap(file);
  const maxSide = 1400;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
}

export function searchProfileData(query: string, data: Awaited<ReturnType<typeof loadProfileData>>): SearchResult {
  const q = query.trim().toLowerCase();
  if (!q) {
    return { answer: '', memories: [], objectLocations: [], photoCards: [], reminders: [] };
  }

  const includes = (...values: Array<string | null | undefined>) => values.join(' ').toLowerCase().includes(q);
  const objectLocations = data.objects.filter((item) => includes(item.object_name, item.location_text));
  const memories = data.memories.filter((item) => includes(item.title, item.body, item.memory_type));
  const photoCards = data.photos.filter((item) => includes(item.name, item.relationship, item.note));
  const reminders = data.reminders.filter((item) => includes(item.title, item.detail, item.category));

  let answer = 'I could not find that yet. You can save it or ask a caregiver to add it.';
  if (objectLocations.length) {
    const item = objectLocations[0];
    answer = `Your ${item.object_name} is ${item.location_text}.`;
  } else if (memories.length) {
    answer = memories[0].body;
  } else if (photoCards.length) {
    const card = photoCards[0];
    answer = `${card.name}${card.relationship ? ` is ${card.relationship}` : ''}. ${card.note || ''}`.trim();
  } else if (reminders.length) {
    const reminder = reminders[0];
    answer = `${reminder.title} is scheduled for ${reminder.scheduled_date} at ${reminder.scheduled_time}.`;
  }

  return { answer, memories, objectLocations, photoCards, reminders };
}
