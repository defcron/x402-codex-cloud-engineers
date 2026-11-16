# Engineer 21 reservation: bounded ICS recurrence occurrences

- **Service key:** `ics-recurrence-occurrence-expander`
- **Owner:** Engineer 21
- **State:** Reserved in isolated branch and recorded in shared ledger. Peer concept reconciliation remains incomplete.
- **Branch:** `engineer-21-ics-recurrence-occurrences`
- **Customer job:** Turn recurring VEVENT definitions into concrete event instances within a caller-specified time window so an agent can populate a scheduler or inspect a finite agenda.
- **Function boundary:** Expand recurrence only; do not detect event conflicts, connect to calendars, fetch URLs, or modify calendar data.
- **Inputs:** Caller-supplied ICS text, explicit UTC or floating start/end bounds, and a maximum occurrence count. Target limits: 64 KiB decoded ICS, 100 VEVENTs, a 366-day window, and at most 500 output occurrences.
- **Output:** Ordered instances containing source event index, UID, summary, start, end, and occurrence index; report skipped/unsupported component counts.
- **Example:** A weekly UTC event with COUNT=3 and DTSTART 2026-11-16T14:00Z expands to three starts: Nov 16, 23, and 30 at 14:00Z, when the window covers those dates.
- **Failure cases:** Reject malformed VCALENDAR, invalid/unsupported recurrence rules, unsupported TZID/local-time cases, detached recurrence overrides, invalid/reversed bounds, oversized input/window/output, and ambiguous duration definitions with stable 4xx issue codes. Never fetch a calendar URL or echo full descriptions/attendees.
- **Initial supported subset:** DTSTART/DTEND; RRULE FREQ=DAILY or WEEKLY with INTERVAL, COUNT, UNTIL and simple BYDAY; RDATE/EXDATE; UTC and floating date-times. Reject other recurrence constructs explicitly rather than silently approximating.
- **Runtime target:** Deterministic, bounded, no network, storage, or paid model/API calls; proposed integration price at most USD 0.005.
- **Live distinctness check (OpenAPI v0.8.206, 2026-11-16):** `POST /v1/ics-events` parses 1–200 VEVENTs and preserves RRULE/RDATE but explicitly does not expand recurrence. `POST /v1/ics-conflicts` compares explicit DTSTART/DTEND intervals but explicitly does not expand recurrence, calculate DURATION, or convert time zones. This reservation excludes conflict detection, the directly overlapping live function.
- **Known other reservations:** Engineer 16's `api-pagination-contract-checker` and engineer 28's `openapi-version-compatibility-matrix` are different customer jobs. The ledger only groups the remaining chats as 01–50 by title; no actual concepts for those engineers are recorded, so global candidate distinctness is unverified.
- **Shared production:** No production integration, deployment, PayAPI submission, wallet spend, or secret use is part of this checkpoint.
- **Next action:** Implement and run focused bounded recurrence tests in an authorized writable isolated source workspace after confirming source-repository conventions; reconcile against other engineers before integration.
