# Chaya Kada V3 — Secure + Chat + Notifications + Admin

A responsive website for office tea calls, shared chat, bill splitting, fun stats and admin cleanup.

## What is new in V3

- Secure shared office room using Supabase Anonymous Auth + server-side office-code verification.
- The office code is **not hardcoded in frontend source** and is not saved after a successful join; the browser keeps its Supabase room membership instead.
- Row Level Security (RLS) prevents members of other rooms from reading your data.
- Realtime Chaya Call across phones/laptops.
- Public chat for everyone who joined the same office code.
- Browser notifications for new Chaya Calls, chat messages and payment updates.
- Service Worker included and Web Push backend code included for notifications even when the website is closed.
- Secure admin login using Supabase Auth email/password + database allow-list.
- Admin can delete people, events and chat messages, or clear the room chat.
- Normal users cannot delete people/events. Users may delete only their own chat message.
- Premium mobile + desktop UI.
- The Malayalam/funny images supplied in chat are included as a reaction/mood wall.

## Important security change

Your old V1/V2 office code was present in public frontend code/GitHub history. Treat that old code as known.

For V3, create a **new office code** and enter it only in Supabase SQL Editor using the private room setup template. Do not commit the real office code to GitHub.

## Correct deployment order

1. In Supabase, enable **Authentication > Anonymous Sign-Ins**.
2. Run `supabase-v3-secure.sql` in SQL Editor.
3. Open `PRIVATE-ROOM-SETUP-TEMPLATE.sql`, copy it into SQL Editor, replace `YOUR_OFFICE_CODE` with a new private code, Run it. Do not save the edited code in GitHub.
4. Create your admin user in **Authentication > Users**.
5. Run `ADMIN-SETUP-TEMPLATE.sql` in SQL Editor after replacing the placeholder email.
6. Upload/push the V3 website files to GitHub Pages.
7. Test from two browsers with the same new office code.
8. Optional but recommended: finish closed-site Web Push using `PUSH-SETUP.md`.

## Notification behaviour

V3 has two notification layers:

- **Immediate browser notifications:** works as soon as a user taps Notifications and keeps the site open/backgrounded while Supabase Realtime is connected.
- **True Web Push when the site is closed:** the Service Worker + subscription database + Supabase Edge Function are already included. You still need to deploy the Edge Function and set the private VAPID secret. This private key is intentionally not stored in this public project.

## Files

- `index.html` — responsive website UI
- `styles.css` — premium dark/funny Kerala-chaya styling
- `app.js` — room access, realtime, chat, splitting, notifications, admin UI
- `service-worker.js` — browser notification + Web Push handler
- `supabase-config.js` — public Supabase URL/publishable key + public VAPID key
- `supabase-v3-secure.sql` — secure V3 database schema and RLS
- `PRIVATE-ROOM-SETUP-TEMPLATE.sql` — private office-code setup template
- `ADMIN-SETUP-TEMPLATE.sql` — admin allow-list template
- `PUSH-SETUP.md` — closed-site push setup
- `supabase/functions/send-chaya-push/index.ts` — secure Web Push sender Edge Function
- `assets/` — tea photos + supplied Malayalam reaction images

## Website only

This remains a normal website. No APK and no app installation is required. Android, iPhone, Windows, Mac and tablets can all use the same GitHub Pages URL.
