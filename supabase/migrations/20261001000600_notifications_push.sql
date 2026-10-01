-- Push delivery (outbox) and overdue tracking.

-- notifications rows double as the push outbox: push_sent_at is null until delivery was attempted
-- successfully (or deliberately skipped, e.g. no registered device).
alter table notifications
  add column push_sent_at timestamptz,
  add column push_attempts integer not null default 0 check (push_attempts >= 0),
  add column push_error text;
create index notifications_unpushed_idx on notifications (created_at) where push_sent_at is null;
create index notifications_unread_idx on notifications (business_id, created_at desc) where read_at is null;

-- The due date we last sent an "overdue" notification for. Notifying is "once per due date": if the
-- due date is later changed and the invoice goes overdue again, it notifies again.
alter table invoices add column overdue_notified_due_date date;
