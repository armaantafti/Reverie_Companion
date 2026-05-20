-- Reverie Companion MVP schema
-- Run this in the Supabase SQL editor.

create extension if not exists pgcrypto;

create type companion_memory_type as enum ('general', 'where_kept', 'person', 'routine', 'medical');
create type companion_board_item_type as enum ('medicine', 'appointment', 'routine', 'family', 'note');
create type companion_reminder_category as enum ('medicine', 'appointment', 'hydration', 'meal', 'custom');
create type companion_ack_status as enum ('done', 'skipped', 'needs_help');
create type companion_caregiver_role as enum ('owner', 'caregiver', 'viewer');

create table if not exists companion_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete cascade,
  display_name text not null,
  preferred_language text default 'en-IN',
  voice_reply_enabled boolean default true,
  large_text_enabled boolean default true,
  emergency_note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists companion_caregiver_links (
  id uuid primary key default gen_random_uuid(),
  senior_profile_id uuid references companion_profiles(id) on delete cascade,
  caregiver_user_id uuid references auth.users(id) on delete cascade,
  role companion_caregiver_role default 'caregiver',
  can_manage_reminders boolean default true,
  can_view_daily_summary boolean default true,
  can_manage_people_cards boolean default true,
  created_at timestamptz default now(),
  unique (senior_profile_id, caregiver_user_id)
);

create table if not exists companion_memories (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references companion_profiles(id) on delete cascade,
  title text not null,
  body text not null,
  memory_type companion_memory_type default 'general',
  source text default 'user',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists companion_object_locations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references companion_profiles(id) on delete cascade,
  object_name text not null,
  location_text text not null,
  photo_url text,
  last_confirmed_at timestamptz default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists companion_daily_board_items (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references companion_profiles(id) on delete cascade,
  board_date date not null,
  label text not null,
  detail text,
  scheduled_time time,
  item_type companion_board_item_type default 'note',
  completed boolean default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists companion_reminders (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references companion_profiles(id) on delete cascade,
  title text not null,
  detail text,
  category companion_reminder_category default 'custom',
  scheduled_date date not null,
  scheduled_time time not null,
  repeat_rule text,
  escalation_minutes int default 10,
  caregiver_escalation_enabled boolean default true,
  last_acknowledged_at timestamptz,
  last_acknowledgement_status companion_ack_status,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists companion_reminder_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid references companion_reminders(id) on delete cascade,
  profile_id uuid references companion_profiles(id) on delete cascade,
  status companion_ack_status default 'done',
  acknowledged_at timestamptz default now()
);

create table if not exists companion_photo_cards (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references companion_profiles(id) on delete cascade,
  name text not null,
  relationship text,
  note text,
  image_url text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists companion_emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references companion_profiles(id) on delete cascade,
  name text not null,
  relationship text,
  phone text not null,
  sort_order int default 0,
  created_at timestamptz default now()
);

alter table companion_profiles enable row level security;
alter table companion_caregiver_links enable row level security;
alter table companion_memories enable row level security;
alter table companion_object_locations enable row level security;
alter table companion_daily_board_items enable row level security;
alter table companion_reminders enable row level security;
alter table companion_reminder_acknowledgements enable row level security;
alter table companion_photo_cards enable row level security;
alter table companion_emergency_contacts enable row level security;

create or replace function companion_can_access_profile(target_profile_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from companion_profiles p
    where p.id = target_profile_id and p.auth_user_id = auth.uid()
  )
  or exists (
    select 1 from companion_caregiver_links l
    where l.senior_profile_id = target_profile_id and l.caregiver_user_id = auth.uid()
  );
$$;

create policy "profiles self access" on companion_profiles
  for all using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());

create policy "caregiver profile read" on companion_profiles
  for select using (companion_can_access_profile(id));

create policy "caregiver links visible" on companion_caregiver_links
  for select using (caregiver_user_id = auth.uid() or companion_can_access_profile(senior_profile_id));

create policy "caregiver links owner managed" on companion_caregiver_links
  for all using (companion_can_access_profile(senior_profile_id)) with check (companion_can_access_profile(senior_profile_id));

create policy "memories profile access" on companion_memories
  for all using (companion_can_access_profile(profile_id)) with check (companion_can_access_profile(profile_id));

create policy "object locations profile access" on companion_object_locations
  for all using (companion_can_access_profile(profile_id)) with check (companion_can_access_profile(profile_id));

create policy "daily board profile access" on companion_daily_board_items
  for all using (companion_can_access_profile(profile_id)) with check (companion_can_access_profile(profile_id));

create policy "reminders profile access" on companion_reminders
  for all using (companion_can_access_profile(profile_id)) with check (companion_can_access_profile(profile_id));

create policy "acknowledgements profile access" on companion_reminder_acknowledgements
  for all using (companion_can_access_profile(profile_id)) with check (companion_can_access_profile(profile_id));

create policy "photo cards profile access" on companion_photo_cards
  for all using (companion_can_access_profile(profile_id)) with check (companion_can_access_profile(profile_id));

create policy "emergency contacts profile access" on companion_emergency_contacts
  for all using (companion_can_access_profile(profile_id)) with check (companion_can_access_profile(profile_id));

create index if not exists idx_companion_memories_profile_type on companion_memories(profile_id, memory_type);
create index if not exists idx_companion_reminders_profile_date on companion_reminders(profile_id, scheduled_date);
create index if not exists idx_companion_daily_board_profile_date on companion_daily_board_items(profile_id, board_date);
create index if not exists idx_companion_object_locations_profile_object on companion_object_locations(profile_id, object_name);
