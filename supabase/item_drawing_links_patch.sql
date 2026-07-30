-- Add Cloudflare drawing link fields to existing CT item master tables.
-- Run this once in the Supabase SQL Editor for an already-created project.

alter table public.ct_items
  add column if not exists drawing_url text,
  add column if not exists drawing_file_name text,
  add column if not exists drawing_content_type text;
