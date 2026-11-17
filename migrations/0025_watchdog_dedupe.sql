-- V1-09 watchdog dedupe: one open alert per assignment+kind.
CREATE UNIQUE INDEX uq_watchdog_open_assignment
  ON watchdog_alerts(assignment_id, kind) WHERE status = 'open';
