# Flag Coach

A 5v5 flag football coaching app for iPad: playbook with a route designer and play animation, roster with photos, huddle mode, and backups. Plain HTML/CSS/JavaScript — no build step, no accounts. Data lives on the iPad (IndexedDB) and the app works offline once installed. Optional team sync shares one playbook across two iPads through a free store you own.

## Run it on the Mac

```bash
python3 .claude/dev_server.py
```

Open http://localhost:8080. The dev server disables caching so edits show up on reload.

**Try it on the iPad (same Wi-Fi):** open `http://<Mac IP>:8080` in Safari. Everything works except offline mode, which needs the hosted `https://` version.

## Put it on the iPad for real (free hosting)

1. Create a GitHub repository and upload everything in this folder (the `.claude` folder is optional).
2. In the repo: **Settings → Pages → Deploy from branch → main → / (root)**.
3. On the iPad, open the `https://<you>.github.io/<repo>/` address in Safari, tap **Share → Add to Home Screen**.
4. Open it once from the Home Screen while online. After that it works with no internet.
5. Test: turn on Airplane Mode and open the app.

## Sharing a playbook with another coach (team sync)

Two iPads can share one playbook. It is off by default — nothing leaves a
device until you turn it on.

**On the iPad that has the playbook**

1. Make the free store both iPads talk to: sign up at
   [supabase.com](https://supabase.com/dashboard), create a project (any region,
   free plan).
2. In that project: **SQL Editor** → paste the block shown in the app
   (Settings → Team sync → Set up team sync → *Copy the SQL*) → **Run**.
3. In the project: **Settings → API** → copy the **Project URL** and the
   **anon public** key into the app, then tap **Start syncing**. This iPad's
   plays, roster, photos and rules go up.
4. Tap **Invite a device** and AirDrop or text the team code to the other coach.

**On the other iPad**

Settings → Team sync → **Join a team** → paste the code. That iPad takes the
team's copy (its own plays are replaced — save a backup first if it has any),
and from then on both stay in step.

**How it behaves**

- Edits go up a few seconds after you make them, and each iPad pulls every 30
  seconds, when it comes back online, and when you reopen the app.
- Offline still works. Changes queue on the iPad and go up next time it has
  internet.
- If two people change the same play, the most recent edit wins. Deletes travel
  too, so removing a play on one iPad removes it on the other.
- The team code is the key to the team: anyone holding it can read and change
  the plays and roster, which include player names and photos. Send it directly
  to the person, don't post it anywhere public, and note that the URL and key
  live only on the paired iPads — they are never part of the app's public files.
- **Stop syncing** unpairs one iPad and leaves everything it has in place.
  Backups keep working exactly as before, synced or not.

## Updating the app

Whenever files change, bump `CACHE` in `sw.js` (e.g. `flagcoach-v2`) before uploading. Next time the iPad opens the app online, it shows **"A new version is ready → Update"**. Plays, roster and photos are not affected by updates.

## Designing against a defense

The play editor shows the defense lined up before the snap. The bar at the top-left
of the field cycles **coverage** (what they do after the snap) and **look** (where
they line up — press, off, bail, wide rusher and so on). Cycling only previews:
the play keeps its own defense until you tap **Use**. The shield button hides the
defense when you want a clean field.

Faded triangles are where the defenders will be when the ball arrives. The letter
on a defender is who they have in man, the red bubble is a zone, and the curve on
their shoulder is the side they're shading.

Defense tab → **vs every look** simulates the play against all nine alignments at
once, which is the fastest way to find the one that breaks it.

## Backups

Settings → **Save backup** creates one `.json` file (plays, roster, photos, seasons). Save it to iCloud Drive. **Restore from backup** replaces everything on the iPad with the file's contents.

## Code map

| File | What it does |
|---|---|
| `js/model.js` | Data shapes, formations, route presets, defensive looks, starter plays |
| `js/store.js` / `js/db.js` | App state and IndexedDB storage |
| `js/sim.js` | `alignDefense` (pre-snap alignment) plus the play simulation: routes, motion, ball, defense, rusher, results |
| `js/stage.js` | Draws and plays back a simulated play |
| `js/field.js` | SVG field, routes, player tokens |
| `js/views/*` | Home, Playbook, Play editor, Huddle, Roster, Settings |
| `sw.js` | Offline cache |
