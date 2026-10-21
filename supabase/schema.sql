-- AI Companion: Supabase schema (Requirement 22.11, 22.16, 22.17).
-- Run in the Supabase SQL editor. Safe to re-run: every statement is idempotent.

-- ---------------------------------------------------------------------------
-- Per-user preferences (synced Primary_Profile name + Settings fields)
-- ---------------------------------------------------------------------------

create table if not exists public.user_preferences (
  user_id                   uuid primary key references auth.users (id) on delete cascade,
  display_name              text not null,
  bot_name                  text not null,
  tone                      text not null,
  provider_mode             text not null,
  ollama_base_url           text not null default '',
  ollama_model              text not null default '',
  check_in_time_override    text,
  activity_tracking_enabled boolean not null default false,
  notifications_enabled     boolean not null default false,
  updated_at                timestamptz not null default now()
);

-- Check constraints (dropped first so the script can be re-run).
alter table public.user_preferences drop constraint if exists user_preferences_display_name_check;
alter table public.user_preferences add constraint user_preferences_display_name_check
  check (char_length(display_name) between 1 and 40);

alter table public.user_preferences drop constraint if exists user_preferences_bot_name_check;
alter table public.user_preferences add constraint user_preferences_bot_name_check
  check (char_length(bot_name) between 1 and 30);

alter table public.user_preferences drop constraint if exists user_preferences_tone_check;
alter table public.user_preferences add constraint user_preferences_tone_check
  check (tone in ('cheerful', 'calm', 'playful'));

alter table public.user_preferences drop constraint if exists user_preferences_provider_mode_check;
alter table public.user_preferences add constraint user_preferences_provider_mode_check
  check (provider_mode in ('auto', 'ollama', 'gemini'));

alter table public.user_preferences drop constraint if exists user_preferences_ollama_base_url_check;
alter table public.user_preferences add constraint user_preferences_ollama_base_url_check
  check (char_length(ollama_base_url) <= 2048);

alter table public.user_preferences drop constraint if exists user_preferences_ollama_model_check;
alter table public.user_preferences add constraint user_preferences_ollama_model_check
  check (char_length(ollama_model) <= 100);

alter table public.user_preferences drop constraint if exists user_preferences_check_in_time_override_check;
alter table public.user_preferences add constraint user_preferences_check_in_time_override_check
  check (check_in_time_override is null or check_in_time_override ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- Row Level Security: each user can only see and change their own row.
alter table public.user_preferences enable row level security;

drop policy if exists "user_preferences_select_own" on public.user_preferences;
create policy "user_preferences_select_own" on public.user_preferences
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user_preferences_insert_own" on public.user_preferences;
create policy "user_preferences_insert_own" on public.user_preferences
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "user_preferences_update_own" on public.user_preferences;
create policy "user_preferences_update_own" on public.user_preferences
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Encrypted backups: private bucket, objects under `${auth.uid()}/...`
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('companion-backups', 'companion-backups', false)
on conflict (id) do nothing;

drop policy if exists "companion_backups_select_own" on storage.objects;
create policy "companion_backups_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'companion-backups' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "companion_backups_insert_own" on storage.objects;
create policy "companion_backups_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'companion-backups' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "companion_backups_update_own" on storage.objects;
create policy "companion_backups_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'companion-backups' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'companion-backups' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "companion_backups_delete_own" on storage.objects;
create policy "companion_backups_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'companion-backups' and (storage.foldername(name))[1] = auth.uid()::text);
