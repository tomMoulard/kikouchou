-- A trip is created without dates, and the organiser sets them later from the
-- calendar's setup checklist. The two preview columns therefore accept null.
--
-- They stay a pair: both set, or both null. Every client reads "one date
-- alone" as no dates, so the database refuses that state rather than store a
-- row the clients would each read differently.
--
-- `trips_dates_ordered` (end_date >= start_date) stays as it is: a check on a
-- null operand is not false, so it passes for a trip without dates.

alter table public.trips
  alter column start_date drop not null,
  alter column end_date drop not null;

alter table public.trips
  add constraint trips_dates_paired
  check ((start_date is null) = (end_date is null));

comment on column public.trips.start_date is
  'First day of the trip. Null, with end_date, for a trip without dates.';
comment on column public.trips.end_date is
  'Check-out day of the trip. Null, with start_date, for a trip without dates.';
