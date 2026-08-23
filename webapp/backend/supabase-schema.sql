create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique,
  name text not null,
  role text not null check (role in ('doctor', 'patient')),
  password_hash text not null,
  doctor_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  doctor_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  age integer,
  condition text,
  has_baseline_data boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.thresholds (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  doctor_id uuid not null references public.users(id) on delete cascade,
  min_angle numeric not null,
  max_angle numeric not null,
  target_reps integer not null,
  motion_limit numeric,
  temp_limit numeric,
  exercise_type text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exercise_history (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  doctor_id uuid not null references public.users(id) on delete cascade,
  date timestamptz not null default now(),
  reps_completed integer,
  target_reps integer,
  max_angle_reached numeric,
  min_angle_reached numeric,
  avg_temp numeric,
  duration_s integer,
  status text,
  exercise_type text
);

create table if not exists public.exercise_prescriptions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  doctor_id uuid not null references public.users(id) on delete cascade,
  youtube_url text not null,
  title text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_patients_doctor_id on public.patients(doctor_id);
create index if not exists idx_thresholds_patient_id on public.thresholds(patient_id);
create index if not exists idx_exercise_history_patient_id on public.exercise_history(patient_id);
create index if not exists idx_exercise_prescriptions_patient_id on public.exercise_prescriptions(patient_id);

alter publication supabase_realtime add table public.patients;
alter publication supabase_realtime add table public.thresholds;
alter publication supabase_realtime add table public.exercise_history;
alter publication supabase_realtime add table public.exercise_prescriptions;
