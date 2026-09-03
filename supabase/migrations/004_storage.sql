-- ===========================================================================
-- 004 — product photo storage
--
-- The owner photographs keychains on a phone at the stand and uploads them
-- straight into the manager, so this bucket is on the critical path for the
-- day-to-day job, not a nice-to-have.
--
-- Public read, no client write. Uploads go through
-- `src/app/api/manager/upload/route.ts`, which checks ownership, checks the
-- declared MIME type against an allowlist, caps the size, and generates the
-- object name itself. A client-side upload policy would mean trusting a
-- browser to pick its own filename, and a filename is request input.
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-photos',
  'product-photos',
  true,
  8388608, -- 8 MiB. A modern phone photo is 2–5 MB; this leaves headroom
           -- without letting a mis-set camera fill the bucket.
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Anyone may read a photo: the storefront is public and the images are the
-- product. The bucket being `public` already implies this; the policy is
-- written out so the intent is visible next to the write rules rather than
-- living only in a dashboard toggle.
drop policy if exists "product photos are publicly readable" on storage.objects;
create policy "product photos are publicly readable" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'product-photos');

-- No insert/update/delete policy for anon or authenticated, on purpose.
-- service_role bypasses RLS, so the API route can still write. Any policy
-- added here later would hand a signed-in stranger write access to the
-- bucket — there is no "just for testing" version of that.
drop policy if exists "product photos are owner-writable" on storage.objects;
