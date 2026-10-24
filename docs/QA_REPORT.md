# Promo Kings Workspace — QA Report

## Summary

Reviewed the login page, Home, Sales/Artworks, Designer, Admin/Artworks, Deliveries and its Item details editor, Riders/New rider request, Users, Route admin, My jobs, and Vehicles. The role-navigation source covers salesperson, designer, admin, production, dispatch, route_admin, and rider.

**Results:** 13 Pass, 1 Fail, 6 Blocked, 2 Not tested. No authenticated user credentials were available, and no records or live database writes were used. Authenticated page behavior therefore received static review, not an end-to-end UI test.

## Static security risk assessment

| Area | Evidence reviewed | Risk | Assessment |
|---|---|---|---|
| Browser credentials | Client code references the Supabase URL and anon key; service-role and credential-encryption keys are read from Edge Function environment variables | Low (static) | No elevated key was found in the searched client files. The anon key is public by design and depends on correct backend RLS. |
| Role enforcement | Client-side route gate plus RLS policies in inspected migrations; user-admin Edge Function checks the authenticated user and active admin role | Medium (not live-verified) | Core artwork, delivery, and rider policies are present. Actual deployed policies and every action/table were not verified against Supabase. |
| Password storage | `user_credentials.encrypted_password` uses reversible encryption with a server-held key; the auth provider also validates passwords | Medium | Encryption reduces exposure at rest but allows recovery when the key is available; it is not equivalent to one-way hashing for the reveal feature. |
| Password viewing | Admin Edge Function invokes `admin_view_password`; SQL function writes an audit-log record | Medium | Server-side admin gate and audit trail are present. View-password access remains sensitive and needs operational review. |

| ID | Page | Role | Scenario | Expected | Actual | Status | Severity |
|---|---|---|---|---|---|---|---|
| P-01 | Login | All | Load sign-in form | Username/password fields and sign-in action load without client errors | Form loaded; browser console had no errors | Pass | — |
| P-02 | Protected pages | Logged out | Directly open home, sales, designer, admin, deliveries, riders, users, route-admin, my-jobs, and vehicles | Redirect to login | All ten URLs redirected to login | Pass | — |
| P-03 | Navigation | All seven roles | Inspect role-to-tab mapping and page gate | Only role-appropriate tabs/pages exposed | Role-specific maps and a direct-page gate exist in client code | Pass (static) | — |
| P-04 | Database access | All roles | Inspect Supabase policies for artwork, delivery, rider jobs, profile access | Backend rules constrain records/actions beyond hidden UI | Reviewed migrations define RLS and role/ownership policies for these tables | Pass (static) | — |
| P-05 | Client configuration | All | Search client JS/config for elevated keys | Only public client key in browser; service key remains server-side | Client references URL and anon key; service role key is read in Edge Function environment | Pass (static) | — |
| P-06 | Static paths | All | Search for stale `/Artworks/` links | No stale renamed-repo paths | No matching paths found in searched HTML, JS, or CSS | Pass | — |
| P-07 | Login layout | Logged out | Check 390px and 1366px widths | No horizontal overflow | Document width matched viewport at both sizes | Pass |
| P-08 | Riders | Salesperson | Mock 8:00, 8:15, 8:16, 11:59, 12:29, 12:30, and 15:00 EAT; inspect minimum date and slots for today/tomorrow/later | Through 8:15, today all; after 8:15 and before 12:30, today 2–4 PM; from 12:30, tomorrow minimum; later dates all slots | All seven cases matched; tomorrow/later had all eight slots | Pass (dry run) | — |
| P-09 | Riders | Salesperson | Submit a selection that becomes stale after a cutoff | Current availability is revalidated and invalid choice rejected | Mocked validation rejected 9 AM after 8:15 and same-day after 12:30 | Pass (dry run) | — |
| P-10 | Sales / Deliveries | Salesperson | Inspect SO prefix logic and validation in request and item-line source | New fields start `SO-`, prefix protected, bare prefix treated as empty | Request and delivery line helpers and required-value checks are present; not browser-tested | Pass (static) | — |
| P-11 | Sales / Deliveries / Riders | Salesperson | Inspect required fields, phone/date/quantity checks, and submit state | Invalid values blocked and repeated submission guarded | Validation and busy-state handling exist in inspected submit handlers | Pass (static) | — |
| P-12 | Users | Admin | Inspect delete control and safeguards | Admin-only action, named confirmation, self/last-admin prevention, selected account only | Client checks and one-target `delete_user` RPC call are present; backend SQL is separate and deployment was not checked | Pass (static) | — |
| P-13 | App pages | All | Inspect error handling and stale-list refresh paths | Failures surfaced and lists refreshed after operations | Most inspected operations show toast errors and refresh lists on success | Pass (static) | — |
| F-01 | Admin artwork edit | Admin | Open an existing artwork's admin edit dialog and inspect SO number input | SO number input should use the same protected prefix behavior as other artwork request editors | Admin edit form's separate `so_number` field is populated from the record but is not bound to the SO prefix helper | Fail | Medium |
| B-01 | Protected pages | Wrong role | Sign in as each role and directly open every other role's URL | Unauthorized pages redirect to the role's home page | No role test accounts/session were available; only logged-out redirects were tested | Blocked | — |
| B-02 | Home / Sales / Designer / Admin | Appropriate roles | Exercise cards, tables, filters, edit dialogs, notifications, and empty/error states | Role-specific flows render and operate as intended | Requires authenticated sessions and loaded data | Blocked | — |
| B-03 | Deliveries / Riders / My jobs / Route admin | Appropriate roles | Exercise requests, assignment, ready/dispatch/delivered, start/finish, decline | Correct role actions and states with no unintended writes | Any end-to-end action risks changing records; no staging dataset was supplied | Blocked | — |
| B-04 | Users | Admin | Open Delete user and verify actual server operation | Confirmed deletion affects only the selected account and preserves related records | No live delete performed. Installed state of `admin_delete_user` RPC cannot be checked without Supabase access | Blocked | — |
| B-05 | Users / authenticated pages | All | Check action wrapping, table overflow, keyboard navigation, and responsive layout | Controls fit and remain usable at 1366px and 390px | Authenticated portal pages could not be rendered in browser | Blocked | — |
| B-06 | All | All | Measure load/network behavior and simulate Supabase outage | Clear offline errors, no repeated excessive calls, acceptable performance | Not assessed against live backend; browser redirects occurred before portal data loaded | Blocked | — |
| N-01 | Users | Admin | Verify View password dialog and audit record | Password shown only to authorized admin and event audited | Static code shows server-side admin check and audit function; runtime behavior not exercised | Not tested | — |
| N-02 | All forms | Appropriate roles | Test special characters, very long inputs, whitespace normalization, double-click Save/Request, and Clear/Discard in each form | Values safely handled, duplicate writes prevented, forms reset correctly | No authenticated test records or isolated staging instance available | Not tested | — |

## Defects

### F-01 — Medium: Admin artwork edit SO number input is not prefix-protected

- **Steps:** Sign in as an administrator in a safe test environment; open **Artworks**, edit a request, and focus the SO number field.
- **Expected:** The input begins with `SO-`, protects the prefix, and treats `SO-` alone as empty, matching the other artwork request fields.
- **Actual:** The separate admin edit input is populated with the stored value but does not use the SO prefix helper.
- **Location:** `admin.html` artwork edit form (`name="so_number"`); `js/app.js` `openAdminEdit`.
- **Impact:** The administrator edit path can accept a value that does not follow the standardized prefix behavior.

## Needs manual test

Use a dedicated, non-production test environment and pre-provisioned role accounts. Do not use production data for these tests.

1. Sign in separately as salesperson, designer, admin, production, dispatch, route_admin, and rider. For each account, try its own tabs and direct URLs for every other role. Verify the expected home redirect and confirm no unauthorized data/actions appear.
2. On a disposable staging dataset, exercise artwork request, edit while Requested, change request/history, designer claim/start/done/notes, and admin filters/export/delete. Verify required-field, whitespace, special-character, and long-value behavior.
3. In staging, exercise delivery item modal add/remove/discard/save, delivery submission, production Ready, dispatch transport/vehicle/Dispatch, and Delivered. Use invalid/valid phone numbers, past dates, empty SO suffix, long values, and repeated clicks. Verify one request per intended submission.
4. In staging, exercise rider request, route-admin assignment and conflict warning, decline reason, and rider Start/Finish. Mock each EAT cutoff and submit a stale form after advancing the mocked clock. Verify no production request is written.
5. After an administrator confirms the deletion SQL has been installed in staging, test named confirmation, cancel, self-delete block, last-admin block, deletion of a disposable user, and preservation/refusal when related history exists. Verify only the target account is removed.
6. With an authorized user logged in, check each page at 1366×768 and 390px, tab order, button wrapping/overflow, console warnings/errors, missing assets, and the Supabase-unavailable message. No save/delete action should be used against production.

## Test limitations and assumptions

- Browser access was limited to the local preview while logged out. Every protected URL returned to login, so the authenticated pages' runtime console, controls, and responsive layout could not be observed.
- Rider availability and stale-submit behavior were tested using a mocked clock and pure helper only. No request was submitted.
- Security review was static and limited to the client key references, inspected Edge Functions, and available Supabase migrations. No penetration test or live Supabase policy check was performed.
- The app includes a `delete_user` call, while the database function is provided as `supabase/manual_admin_delete_user.sql`. The database's installed function state is unknown; SQL was not executed.
- Performance and outage behavior cannot be concluded from the logged-out local preview. Duplicate-submit and real backend integrity tests require an isolated staging environment.
