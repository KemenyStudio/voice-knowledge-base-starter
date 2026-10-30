-- Per-user voice call behavior. Additive: existing rows keep today's call
-- (normal length, app navigation allowed). Safe to apply before the app deploy.

alter table public.assistant_user_prefs
  add column if not exists voice_length text not null default 'normal',
  add column if not exists voice_navigation text not null default 'app';

alter table public.assistant_user_prefs
  drop constraint if exists assistant_user_prefs_voice_length_check;
alter table public.assistant_user_prefs
  add constraint assistant_user_prefs_voice_length_check
  check (voice_length in ('breve', 'normal', 'detallada'));

alter table public.assistant_user_prefs
  drop constraint if exists assistant_user_prefs_voice_navigation_check;
alter table public.assistant_user_prefs
  add constraint assistant_user_prefs_voice_navigation_check
  check (voice_navigation in ('app', 'library'));

comment on column public.assistant_user_prefs.voice_length is
  'Spoken answer length for this user: breve, normal (current), or detallada.';
comment on column public.assistant_user_prefs.voice_navigation is
  'app: the call may open app screens when those tools exist. library: documents only.';
