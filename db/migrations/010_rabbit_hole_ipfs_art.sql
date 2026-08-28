-- Immutable IPFS artwork and metadata identifiers for Rabbit Hole claims.

alter table rabbit_hole_eligibility
  add column if not exists image_cid text,
  add column if not exists metadata_cid text,
  add column if not exists image_url text,
  add column if not exists pinned_at timestamptz;

create unique index if not exists rabbit_hole_metadata_cid_unique
  on rabbit_hole_eligibility(metadata_cid)
  where metadata_cid is not null;

create index if not exists rabbit_hole_claimed_wallet_idx
  on rabbit_hole_eligibility(claimed_at desc, lower(wallet_address))
  where status = 'claimed';
