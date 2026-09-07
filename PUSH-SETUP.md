# Chaya Kada V3 — True Web Push Setup

The website already registers a Service Worker and saves browser Push API subscriptions. The matching sender is the Supabase Edge Function at:

`supabase/functions/send-chaya-push/index.ts`

## Required secrets

Set these only in Supabase Edge Function secrets:

- `CHAYA_VAPID_PUBLIC_KEY` — same public key as `supabase-config.js`
- `CHAYA_VAPID_PRIVATE_KEY` — **secret; never put it in GitHub or frontend code**
- `CHAYA_VAPID_SUBJECT` — e.g. `mailto:your-email@example.com`

Supabase automatically provides `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions.

## Deploy

You can deploy the function with Supabase CLI or create an Edge Function in the Supabase dashboard and paste the contents of `index.ts`.

Function name must be exactly:

`send-chaya-push`

After deployment, each browser should open the website and tap **Notifications** once. That stores its push subscription in the secure room.

Then:

- New Chaya Call -> push to other subscribed room members.
- New chat message -> push to other subscribed room members.
- Notification tap -> opens the correct website view.

## Security

The Edge Function validates the caller's Supabase Auth JWT and verifies that the caller belongs to the requested room before sending anything. It uses the Service Role only inside the server-side function to read push subscriptions; the Service Role key is never sent to the browser.
