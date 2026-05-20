-- Reverie Companion production schema
-- Run this in the Supabase SQL editor.

create extension if not exists pgcrypto;

do $$ begin
  create type companion_memory_type as enum ('general', 'where_kept', 'person', 'routine', 'medical');
exception when duplicate_object then null; end $$;

do $$ begin
  create type companion_board_item_type as enum ('medicine', 'appointment', 'routine', 'family', 'note');
exception when duplicate_object then null; end $$;

do $$ begin
  create type companion_reminder_category as enum ('medicine', 'appointment', 'hydration', 'meal', 'custom');
exception when duplicate_object then null; end $$;

do $$ begin
  create type companion_ack_status as enum ('done', 'skipped', 'needs_help');
exception when duplicate_object then null; end $$;

do $$ begin
  create type companion_caregiver_role as enum ('owner', 'caregiver', 'viewer');
exception when duplicate_object then null; end $$;

create table if not exists companion_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete cascade,
  display_name text not null,
  preferred_language text default 'en-IN',
  voice_reply_enabled boolean default true,
  large_text_enabled boolean default true,
  high_contrast_enabled boolean default false,
  emergency_note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (auth_user_id)
);

alter table companion_profiles add column if not exists high_contrast_enabled boolean default false;
alter table companion_profiles add column if not exists updated_at timestamptz default now();

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

create table if not exists companion_caregiver_invites (
  id uuid primary key default gen_random_uuid(),
  senior_profile_id uuid references companion_profiles(id) on delete cascade,
  invite_code text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists companion_memories (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references companion_profiles(id) on delete cascade,
  title text not null,
  body text not null,
  memory_type companion_memory_type default 'general',
  source text default 'user',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table companion_memories add column if not exists updated_at timestamptz default now();

create table if not exists companion_object_locations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references companion_profiles(id) on delete cascade,
  object_name text not null,
  location_text text not null,
  photo_url text,
  last_confirmed_at timestamptz default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table companion_object_locations add column if not exists updated_at timestamptz default now();

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
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table companion_daily_board_items add column if not exists updated_at timestamptz default now();

create table if not exists companion_reminders (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references companion_profiles(id) on delete cascade,
  title text not null,
  detail text,
  category companion_reminder_category default 'custom',
  scheduled_date date not null,
  scheduled_time time not null,
  repeat_rule text default 'none',
  escalation_minutes int default 10,
  caregiver_escalation_enabled boolean default true,
  last_acknowledged_at timestamptz,
  last_acknowledgement_status companion_ack_status,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table companion_reminders add column if not exists repeat_rule text default 'none';
alter table companion_reminders add column if not exists updated_at timestamptz default now();

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
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table companion_photo_cards add column if not exists updated_at timestamptz default now();

create table if not exists companion_emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references companion_profiles(id) on delete cascade,
  name text not null,
  relationship text,
  phone text not null,
  sort_order int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table companion_emergency_contacts add column if not exists updated_at timestamptz default now();

create table if not exists companion_device_tokens (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete cascade,
  profile_id uuid references companion_profiles(id) on delete cascade,
  platform text not null default 'android',
  token text not null,
  enabled boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (auth_user_id, token)
);

create table if not exists companion_notification_events (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid references companion_reminders(id) on delete cascade,
  profile_id uuid references companion_profiles(id) on delete cascade,
  event_key text not null,
  channel text not null default 'fcm',
  status text not null default 'queued',
  payload jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  unique (reminder_id, event_key, channel)
);

create or replace function companion_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists companion_profiles_touch on companion_profiles;
create trigger companion_profiles_touch before update on companion_profiles
for each row execute function companion_touch_updated_at();

drop trigger if exists companion_memories_touch on companion_memories;
create trigger companion_memories_touch before update on companion_memories
for each row execute function companion_touch_updated_at();

drop trigger if exists companion_object_locations_touch on companion_object_locations;
create trigger companion_object_locations_touch before update on companion_object_locations
for each row execute function companion_touch_updated_at();

drop trigger if exists companion_daily_board_items_touch on companion_daily_board_items;
create trigger companion_daily_board_items_touch before update on companion_daily_board_items
for each row execute function companion_touch_updated_at();

drop trigger if exists companion_reminders_touch on companion_reminders;
create trigger companion_reminders_touch before update on companion_reminders
for each row execute function companion_touch_updated_at();

drop trigger if exists companion_photo_cards_touch on companion_photo_cards;
create trigger companion_photo_cards_touch before update on companion_photo_cards
for each row execute function companion_touch_updated_at();

drop trigger if exists companion_emergency_contacts_touch on companion_emergency_contacts;
create trigger companion_emergency_contacts_touch before update on companion_emergency_contacts
for each row execute function companion_touch_updated_at();

drop trigger if exists companion_device_tokens_touch on companion_device_tokens;
create trigger companion_device_tokens_touch before update on companion_device_tokens
for each row execute function companion_touch_updated_at();

alter table companion_profiles enable row level security;
alter table companion_caregiver_links enable row level security;
alter table companion_caregiver_invites enable row level security;
alter table companion_memories enable row level security;
alter table companion_object_locations enable row level security;
alter table companion_daily_board_items enable row level security;
alter table companion_reminders enable row level security;
alter table companion_reminder_acknowledgements enable row level security;
alter table companion_photo_cards enable row level security;
alter table companion_emergency_contacts enable row level security;
alter table companion_device_tokens enable row level security;
alter table companion_notification_events enable row level security;

drop policy if exists "profiles self access" on companion_profiles;
drop policy if exists "caregiver profile read" on companion_profiles;
drop policy if exists "caregiver links visible" on companion_caregiver_links;
drop policy if exists "caregiver links owner managed" on companion_caregiver_links;
drop policy if exists "caregiver invites profile access" on companion_caregiver_invites;
drop policy if exists "caregiver invites accept lookup" on companion_caregiver_invites;
drop policy if exists "memories profile access" on companion_memories;
drop policy if exists "object locations profile access" on companion_object_locations;
drop policy if exists "daily board profile access" on companion_daily_board_items;
drop policy if exists "reminders profile access" on companion_reminders;
drop policy if exists "acknowledgements profile access" on companion_reminder_acknowledgements;
drop policy if exists "photo cards profile access" on companion_photo_cards;
drop policy if exists "emergency contacts profile access" on companion_emergency_contacts;
drop policy if exists "device tokens self access" on companion_device_tokens;
drop policy if exists "notification events profile read" on companion_notification_events;

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

create or replace function companion_accept_caregiver_invite(invite_code_input text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_record companion_caregiver_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select *
  into invite_record
  from companion_caregiver_invites
  where invite_code = upper(trim(invite_code_input))
    and accepted_at is null
    and expires_at > now()
  limit 1;

  if not found then
    raise exception 'Invite code was not found or has expired.';
  end if;

  insert into companion_caregiver_links (
    senior_profile_id,
    caregiver_user_id,
    role
  )
  values (
    invite_record.senior_profile_id,
    auth.uid(),
    'caregiver'
  )
  on conflict (senior_profile_id, caregiver_user_id) do update
  set role = excluded.role;

  update companion_caregiver_invites
  set accepted_at = now()
  where id = invite_record.id;

  return invite_record.senior_profile_id;
end;
$$;

revoke all on function companion_accept_caregiver_invite(text) from public;
grant execute on function companion_accept_caregiver_invite(text) to authenticated;

create or replace function companion_list_profile_caregivers(target_profile_id uuid)
returns table (
  link_id uuid,
  caregiver_user_id uuid,
  display_name text,
  role companion_caregiver_role,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from companion_profiles p
    where p.id = target_profile_id
      and p.auth_user_id = auth.uid()
  ) then
    raise exception 'Only the profile owner can view linked caregivers.';
  end if;

  return query
  select
    l.id as link_id,
    l.caregiver_user_id,
    cp.display_name,
    l.role,
    l.created_at
  from companion_caregiver_links l
  left join companion_profiles cp
    on cp.auth_user_id = l.caregiver_user_id
  where l.senior_profile_id = target_profile_id
  order by l.created_at desc;
end;
$$;

revoke all on function companion_list_profile_caregivers(uuid) from public;
grant execute on function companion_list_profile_caregivers(uuid) to authenticated;

create or replace function companion_revoke_caregiver_link(link_id_input uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from companion_caregiver_links l
    join companion_profiles p on p.id = l.senior_profile_id
    where l.id = link_id_input
      and p.auth_user_id = auth.uid()
  ) then
    raise exception 'Only the profile owner can revoke caregiver access.';
  end if;

  delete from companion_caregiver_links
  where id = link_id_input;
end;
$$;

revoke all on function companion_revoke_caregiver_link(uuid) from public;
grant execute on function companion_revoke_caregiver_link(uuid) to authenticated;

create policy "profiles self access" on companion_profiles
  for all using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());

create policy "caregiver profile read" on companion_profiles
  for select using (companion_can_access_profile(id));

create policy "caregiver links visible" on companion_caregiver_links
  for select using (caregiver_user_id = auth.uid() or companion_can_access_profile(senior_profile_id));

create policy "caregiver links owner managed" on companion_caregiver_links
  for all using (companion_can_access_profile(senior_profile_id)) with check (companion_can_access_profile(senior_profile_id));

create policy "caregiver invites profile access" on companion_caregiver_invites
  for all using (companion_can_access_profile(senior_profile_id)) with check (companion_can_access_profile(senior_profile_id));

create policy "caregiver invites accept lookup" on companion_caregiver_invites
  for select using (accepted_at is null and expires_at > now());

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

create policy "device tokens self access" on companion_device_tokens
  for all using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());

create policy "notification events profile read" on companion_notification_events
  for select using (companion_can_access_profile(profile_id));

create index if not exists idx_companion_memories_profile_type on companion_memories(profile_id, memory_type);
create index if not exists idx_companion_memories_search on companion_memories using gin (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body, '')));
create index if not exists idx_companion_reminders_profile_date on companion_reminders(profile_id, scheduled_date, scheduled_time);
create index if not exists idx_companion_daily_board_profile_date on companion_daily_board_items(profile_id, board_date);
create index if not exists idx_companion_object_locations_profile_object on companion_object_locations(profile_id, lower(object_name));
create index if not exists idx_companion_photo_cards_profile_name on companion_photo_cards(profile_id, lower(name));
create index if not exists idx_companion_device_tokens_auth on companion_device_tokens(auth_user_id);

insert into storage.buckets (id, name, public)
values ('companion-photos', 'companion-photos', true)
on conflict (id) do nothing;

drop policy if exists "companion photos accessible profiles read" on storage.objects;
drop policy if exists "companion photos accessible profiles insert" on storage.objects;
drop policy if exists "companion photos accessible profiles update" on storage.objects;
drop policy if exists "companion photos accessible profiles delete" on storage.objects;

create policy "companion photos accessible profiles read" on storage.objects
  for select using (
    bucket_id = 'companion-photos'
    and companion_can_access_profile((storage.foldername(name))[1]::uuid)
  );

create policy "companion photos accessible profiles insert" on storage.objects
  for insert with check (
    bucket_id = 'companion-photos'
    and companion_can_access_profile((storage.foldername(name))[1]::uuid)
  );

create policy "companion photos accessible profiles update" on storage.objects
  for update using (
    bucket_id = 'companion-photos'
    and companion_can_access_profile((storage.foldername(name))[1]::uuid)
  ) with check (
    bucket_id = 'companion-photos'
    and companion_can_access_profile((storage.foldername(name))[1]::uuid)
  );

create policy "companion photos accessible profiles delete" on storage.objects
  for delete using (
    bucket_id = 'companion-photos'
    and companion_can_access_profile((storage.foldername(name))[1]::uuid)
  );
