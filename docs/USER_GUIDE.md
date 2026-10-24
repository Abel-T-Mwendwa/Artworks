# Promo Kings Workspace — User Guide

## Sign in and get help

Open the Workspace login page, enter your username and password, and choose **Sign in**. Passwords must be at least eight characters. A temporary password prompts you to choose a new password before continuing. Choose **Log out** when finished, especially on a shared computer.

Use the navigation tabs to move between your work areas. On a phone, choose **Menu** to open the tabs. **Notifications** shows updates; designers also have **Changes** and **New assignments** shortcuts. The **?** menu lists keyboard shortcuts: Enter saves an open form, + adds a line, − removes a focused line, and Esc closes a popup.

If a page does not load, a request fails, or access seems wrong, contact your team supervisor or Workspace administrator. Include the page, approximate time, and any error shown; do not send passwords in a message.

## Salesperson

Your tabs are **Home**, **Artworks**, **Deliveries**, and **Riders**. A salesperson with route-admin access also has **Route admin**.

### Request and track artwork

1. Open **Artworks** and choose **+ New request**.
2. Complete the category, client, SO number, product details, branding, required artwork options, date needed, and any additional information. Choose a preferred designer if appropriate.
3. The SO number starts with **SO-**. Enter only the part after the prefix; a bare `SO-` is not a complete number.
4. Choose **Save request**. The request appears in your list with its reference and status.
5. Search by reference or client, filter by status, and use the period selector to review activity.
6. Use **History** to see change history. **Change** opens a change request. **Edit** is available while a request is still Requested.

### Request a delivery

1. Open **Deliveries** and choose **New request**.
2. Enter client and contact details and a valid contact number.
3. Choose **Click to add item details**. Each line needs an SO number, item name, positive whole-number quantity, and address in Place, Town, County format. SO numbers start with **SO-**; enter only the remaining characters.
4. Choose **Add line** for additional items. **Save changes** accepts complete lines. **Discard** closes the editor and may ask whether to discard unsaved changes.
5. Select delivery date and hourly time, add any special instruction, then choose **Request**. **Clear** resets the form.
6. Search or filter delivery requests to follow their production and dispatch statuses.

### Request a rider

1. Open **Riders**, complete the client, contact, phone, address, type, and details fields.
2. Choose a date and an **Expected time** between 9:00 AM and 4:00 PM.
3. Availability uses Africa/Nairobi time: through 8:15 AM, all slots are available today; after 8:15 AM and before 12:30 PM, only 2:00, 3:00, and 4:00 PM are available today; at or after 12:30 PM, choose tomorrow or later. Past dates are unavailable.
4. Choose **Request**. Use the request list and status filter to follow the request.

## Designer

Your tabs are **Home** and **Artworks**.

1. In **Artworks**, use the filter for needed today/tomorrow, pending work, completed work, changes, or new assignments.
2. Choose **Start** on an available job to claim it and begin work.
3. Add work notes or a final-file URL and choose **Save notes**. Mark the job **Done** when finished.
4. Review change requests in the row or use the **Changes** shortcut. Use **New assignments** to filter specifically assigned work.

## Production

Your tabs are **Home** and **Deliveries**.

1. In **Deliveries**, search or filter for requests that are not ready.
2. Review the request using **View** if needed.
3. Choose **Ready** when production is complete. Dispatch staff can then arrange dispatch.

## Dispatch

Your tabs are **Home**, **Deliveries**, and **Vehicles**.

1. In **Deliveries**, review requests marked Ready.
2. Select a transport type. For Company transport, select an active vehicle. Choose **Dispatch**.
3. Once delivery is complete, choose **Delivered**.
4. In **Vehicles**, register or edit vehicles and mark whether each is active. **Clear** resets the vehicle form.

## Route administrator

Your tabs are **Home** and **Route admin**.

1. Search rider requests and filter by status.
2. For an unassigned request, choose an active rider and an hourly rider slot, then choose **Assign**. A warning appears if that rider already has a job at that date and time.
3. To decline a request, choose **Decline** and enter a reason.
4. Review the Riders list to see available rider accounts.

## Rider

Your tabs are **Home** and **My jobs**.

1. In **My jobs**, use **Show** to select unfinished, finished, or all jobs.
2. Review the client, contact, address, type, expected time, and assigned rider time.
3. Choose **Start** when beginning an assigned job, then **Finish** when it is complete.

## Administrator

Your tabs are **Home**, **Artworks**, **Users**, **Deliveries**, **Route admin**, and **Vehicles**.

### Manage artwork

Use filters, search, and the period selector to review all artwork requests. Choose **Edit** to change request details, assignment, or status; **Export filtered CSV** downloads the current filtered list. **Delete artwork** permanently removes the artwork and its change history; confirm carefully.

### Manage users

1. In **Users**, enter a full name, username, temporary password, and role, then choose **Add user**. Enable route-admin access only when needed. Share temporary passwords securely.
2. Use **Reset password** to set a user's password. Use **View password** only when necessary; this action is recorded in the audit log.
3. **Delete user** is intended to delete one account only. It must not be used to delete the signed-in administrator or the last administrator. The required server-side deletion function is supplied separately as `supabase/manual_admin_delete_user.sql`; it must be installed by an authorized operator before the button can work. If deletion reports an error, stop and contact the Workspace administrator. Do not retry by deleting related records.

Administrators also have delivery, route-admin, and vehicle workflows described above. Admin-only route access can view and manage rider jobs.

## Rules and common errors

- Keep the **SO-** prefix and enter only the remaining SO number. `SO-` alone is empty.
- Rider availability is based on the current Africa/Nairobi time and is checked again when the request is submitted. If a cutoff has passed while the form was open, choose a newly available date or time.
- Delivery phone numbers must contain a valid phone number. Delivery item quantity must be a positive whole number, and the delivery address must include Place, Town, and County.
- Required fields must be completed before a request can be submitted. If a save fails, read the message, check the required fields and connection, and retry only after confirming that the request was not saved.
- If your access is denied or a page returns you to the login/home page, confirm you are using the correct account and contact your administrator. Never share your password.
