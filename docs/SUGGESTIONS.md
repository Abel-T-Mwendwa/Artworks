# Promo Kings Workspace — Prioritized Suggestions

## Now

- **Protect SO numbers in the administrator artwork edit dialog (S, correctness):** Apply the same prefix protection and empty-suffix validation used in the other request editors; the current admin edit field is an uncovered path.
- **Confirm and test the user-deletion backend before enabling the button (M, security/data integrity):** Verify the guarded `admin_delete_user` function is installed in staging and that linked requests/history block deletion without cascade; the live database deployment state is unknown.
- **Add authenticated regression coverage for the role gates (M, security):** Test each role's navigation and direct URL restrictions, and retain database RLS assertions so front-end hiding is not the sole access control.

## Next

- **Create disposable staging fixtures for each role (M, QA/reliability):** This enables full form, status transition, delete guard, and failure-path tests without risking real records.
- **Test and adjust table layouts with authenticated pages at desktop and mobile widths (M, UX):** In particular confirm the Users Actions buttons fit at desktop size and remain usable on mobile.
- **Exercise duplicate-click and validation paths for every submit flow (M, data integrity):** Verify busy buttons prevent double writes and cover whitespace, special characters, excessive text, dates, and phone numbers.
- **Add explicit loading/offline/empty-state checks across pages (M, reliability):** Confirm the user can distinguish an empty result from a failed Supabase request and that refresh errors are visible.
- **Review View password operational exposure (M, security):** Confirm the audited action is restricted to authorized administrators, determine a retention/rotation policy for encrypted credentials, and consider whether revealing passwords is required versus resetting them.
- **Verify deletion behavior against all profile foreign keys (M, data integrity):** Ensure a deletion either removes only the account where safe or refuses with a clear message while preserving artwork, delivery, rider, audit, and notification history.

## Later

- **Measure Supabase query count and load time per role (M, performance):** Check repeated refreshes, real-time subscriptions, paginated loads, and slow/offline recovery using representative staging data.
- **Add a non-production automated EAT cutoff suite (S, reliability):** Keep the 8:00, 8:15, 8:16, 11:59, 12:29, 12:30, and 15:00 cases plus stale-submit validation as a repeatable test.
- **Review reporting labels and summary definitions with users (S, reporting):** Confirm tally periods and status meanings match operational expectations across artwork, delivery, and rider workflows.
- **Improve rider capacity planning (M, operations):** Consider a calendar/availability view that combines scheduled rider requests and assigned rider slots, with clear conflict handling.
- **Review delivery and rider lifecycle reporting (M, reporting):** Add agreed operational measures such as time from request to ready, dispatch to delivery, rider assignment to completion, and declined-request reasons.
