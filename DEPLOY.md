# Artwork Tracker Deployment Guide

## Deploy for the first time

1. **Check the project configuration.** Open `config.js` and confirm it contains only the Supabase Project URL and the anon/publishable key. Never put a `service_role` key or other secret in browser code. Confirm there is no `.env` file containing secrets in the project folder. The included `.gitignore` excludes `.env` files and `node_modules`. The logo path is relative in the HTML pages.

2. **Back up the artwork data, then run database updates.** In the Supabase dashboard, open **Table Editor → artwork_requests** and export the table as CSV before changing the database. Open **SQL Editor** and run any new files in `supabase/migrations` in filename order:
   - `20261021000000_branding_size_free_text.sql`
   - `20261022000000_request_detail_lines.sql`
   
   Do not rerun migrations that have already been applied.

3. **Redeploy the changed Edge Functions.** Open a terminal in the project folder with the Supabase CLI installed and the project linked, then run:

   ```sh
   supabase functions deploy login --no-verify-jwt
   supabase functions deploy user-admin --no-verify-jwt
   ```

   The `CREDENTIAL_ENCRYPTION_KEY` Supabase secret is already set; do not put it in this folder or in browser code.

4. **Check the password policy.** In Supabase, open **Authentication → Sign In / Up** or **Authentication → Providers**, find **Password requirements / Minimum password length**, and set it to **8**.

5. **Create a public GitHub repository.** On GitHub, create a new **public** repository. In a terminal, move to this project folder and replace the example URL below with the repository URL GitHub gives you. If Git is already initialized, skip `git init`.

   ```sh
   git init
   git add .
   git commit -m "Deploy Artwork Tracker"
   git branch -M main
   git remote add origin https://github.com/USER/REPOSITORY.git
   git push -u origin main
   ```

6. **Turn on GitHub Pages.** In the repository, open **Settings → Pages**. Choose **Deploy from a branch**, select `main` and `/ (root)`, then save.

7. **Set the Supabase website addresses.** In Supabase, open **Authentication → URL Configuration**. Set **Site URL** to `https://USER.github.io/REPOSITORY/` and add that same GitHub Pages address to **Redirect URLs**.

8. **Open the live site and test it.** Visit `https://USER.github.io/REPOSITORY/` in a private/incognito window. Hard refresh the page, then run the live smoke test in the checklist below.

9. **Update the site later.** Change the files, test locally, then run:

   ```sh
   git add .
   git commit -m "Describe the update"
   git push
   ```

   Hard refresh the live site after GitHub Pages finishes deploying. To roll back a published commit without rewriting history, run `git revert COMMIT_HASH`, then push the revert:

   ```sh
   git revert COMMIT_HASH
   git push
   ```

## Pre-deployment test checklist

### Logo

- [ ] The logo shows centred above the sign-in form.
- [ ] The logo shows at the upper left of the salesperson, designer, and admin dashboards; clicking it goes to that user's dashboard.
- [ ] The favicon works on all pages.
- [ ] The logo and header controls are not cut off at phone or laptop widths, including 360px.
- [ ] The logo works when the site is served from a repository subfolder path.
- [ ] If the logo file is unavailable, its image is hidden cleanly with no broken-image icon.

### Buttons and layout

- [ ] Buttons use consistent sizing and shape, clear outlines, hover/pressed states, keyboard focus rings, and visibly disabled states.
- [ ] Save, Done, Change, Edit, Delete, Cancel/Discard, and Add line buttons use the expected colour roles.
- [ ] Related buttons align in tidy groups; table actions and popup button bars do not overlap or clip.
- [ ] Login, sales, designer, and admin pages and their popups are tidy at 360px, 768px, and desktop width.

### Login and access control

- [ ] A wrong password displays a clear message; five failed attempts trigger the lockout.
- [ ] A first login requires a password change before the dashboard can be used.
- [ ] Seven-character passwords are rejected and eight-character passwords are accepted.
- [ ] The user stays signed in after closing and reopening the browser within 24 hours.
- [ ] Set `loginAt` in local storage to a timestamp 25 hours ago and reload; verify the user is signed out and asked to log in again.
- [ ] Each role lands on its own page; manually opening another role's page or URL redirects to the correct page.
- [ ] Logged-out dashboard access redirects to login.
- [ ] A user deactivated by an admin is blocked.

### Salesperson

- [ ] Required-field validation blocks incomplete requests; a past needed date is rejected.
- [ ] Saving creates a server-generated reference number with an increasing sequence.
- [ ] Delete a request and verify it disappears after saving.
- [ ] Edit is available only while a request is `Requested`.
- [ ] For each line-editor popup, add and remove lines, save, and discard edits; verify the saved values are correct.
- [ ] The change popup opens, validates, and submits a change request.
- [ ] Tally cards update and the Day/Month/Year filter works.
- [ ] A designer's Done update appears live.

### Designer

- [ ] The designer sees only requests assigned to them and requests assigned to `Any`.
- [ ] An `Any` request can be claimed only once.
- [ ] Notes and Done actions work.
- [ ] The three multi-line request fields open as view-only popups and cannot be edited.
- [ ] The change banner and notification count remain until the changes are marked Done.

### Admin

- [ ] Filters work and the CSV export contains the filtered requests.
- [ ] Adding a user works; a duplicate username produces a clear message.
- [ ] Role changes and deactivation/reactivation work.
- [ ] Password reset and password view work; viewing a password creates an `audit_log` entry.
- [ ] Deleting a request removes it from the list.

### Phone testing

- [ ] Complete the full workflow on a real phone.
- [ ] Repeat the phone workflow using browser device emulation.

### Security

- [ ] No secret keys are committed to the public repository or included in browser code.
- [ ] Test directly that RLS blocks cross-role access.
- [ ] Review every file in the public repository to ensure it contains no private information.

### Live smoke test after deployment

- [ ] Sign in as `IT`, add a test request, claim and finish it as a designer, then delete the test data.
