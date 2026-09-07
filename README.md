# ☕ Chaya Kada V2

A responsive office tea-call + bill-splitting website with Malayalam flavour.

## What already works
- First-time name + shared office code
- Start a Chaya Call
- Join the current Chaya Gang
- Enter total bill and payer
- Auto split across selected people
- Pending/paid settlement tracking
- Tea trip history
- Fun stats: Chaya King, biggest sponsor, most pending, total economy
- Responsive phone + laptop UI
- Your supplied tea images included
- Local demo mode (no database required)
- Supabase shared realtime mode for many phones/laptops
- Same office code = same live room/data

## Quick local test
You can double-click `index.html`, but a tiny local web server is more reliable.

Python:

```bash
python -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

Default office code:

```text
CHAYA2026
```

Change it in `supabase-config.js`.

## IMPORTANT: GitHub Pages alone is not shared
GitHub Pages only hosts the frontend. To make Chaya Calls and bills appear on other phones, connect Supabase.

## Make it shared for everyone
1. Create a free Supabase project.
2. Open Supabase > SQL Editor and run `supabase.sql`.
3. Open Project Settings > API.
4. Copy your Project URL and anon public key.
5. Paste them in `supabase-config.js`.
6. Push this folder to GitHub.
7. Import the GitHub repo into Vercel and deploy as a static site.

No build command is required. Root directory is the folder containing `index.html`.

## Important security note
The current office code is a friendly frontend gate. It is not strong authentication because a public static site exposes its frontend code. For a small trusted office group this can be acceptable. For stronger privacy, add Supabase Auth (OTP/magic link) or restrict access through a private network/VPN.

## Files
- `index.html` — UI
- `styles.css` — responsive premium theme
- `app.js` — app logic
- `supabase-config.js` — backend URL/key + office code
- `supabase.sql` — database schema + realtime setup
- `assets/` — supplied tea photos
