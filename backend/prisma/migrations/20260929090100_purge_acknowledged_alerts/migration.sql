-- Acknowledging an alert now deletes it (see POST /api/alerts/:id/acknowledge),
-- so rows stamped by the old behaviour would sit on the list forever as
-- "Acknowledged" entries nobody can clear. Remove them once, here.
DELETE FROM "Alert" WHERE "acknowledgedAt" IS NOT NULL;
