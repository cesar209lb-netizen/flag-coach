# Flag Coach

A 5v5 flag football coaching app, built for a coach's iPad but usable from any
phone, tablet or computer: playbook with a route designer and play animation,
roster with photos, huddle mode, and backups. Plain HTML/CSS/JavaScript — no
build step, no accounts. Data lives on the device (IndexedDB), and the app keeps
working with no signal once installed — which matters on a field on game day.
Optional team sync shares one playbook across every paired device, and hands
players a read-only copy, through a free store you own.

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

## Route lab

The **Routes** tab is a standalone drill: one QB, one receiver, and a route.
Drag either player anywhere, tap a route, and press play. The throw is timed so
the ball arrives where the route finishes — a go ball goes deep, a hitch is
thrown at the hitch — and the readout gives the depth and where it was caught.
Out, corner and flat break toward the nearest sideline, so **Flip** or dragging
across the field runs them the other way. Nothing here touches the playbook.

## Sharing a playbook with another coach (team sync)

Paired devices can share one playbook. It is off by default — nothing leaves a
device until you turn it on.

**On the device that has the playbook**

1. Make the free store every device talks to: sign up at
   [supabase.com](https://supabase.com/dashboard), create a project (any region,
   free plan).
2. In that project: **SQL Editor** → paste the block shown in the app
   (Settings → Team sync → Set up team sync → *Copy the SQL*) → **Run**.
3. In the project: **Settings → API** → copy the **Project URL** and the
   **publishable** key into the app, then tap **Start syncing**. This device's
   plays, roster, photos and rules go up.
4. Tap **Invite a device** and AirDrop or text the team code to the other coach.

**On the other device**

Settings → Team sync → **Join a team** → paste the code. That device takes the
team's copy (its own plays are replaced — save a backup first if it has any),
and from then on both stay in step.

**Giving players a read-only copy**

Players (or parents) can study the playbook on their own phone without being
able to change anything, and without seeing the roster.

1. Coach: Settings → Team sync → **Invite a player**. The sheet shows a short
   SQL block — run it once in the store's SQL Editor to switch player view on.
   Teams set up after this feature shipped already have it; running it twice is
   harmless.
2. Send the **player code** from that same sheet. It is safe to give the whole
   team.
3. The player installs the app and pastes it into Settings → Team sync →
   **Join a team**, same as a coach.

A player device gets the playbook and full-screen animated Huddle mode, with no
Roster tab, no editing and no New Play. In Huddle mode the **Watch** picker
spotlights one player's route and fades the rest, and aims the pass at them with
the release timed for that route — so a kid sees the play with the ball coming
to them. Local edits on a player device are refused outright rather than
queued, so it stays an exact mirror of the coaches' playbook.

The player code is the SHA-256 of the coach's team code, and the store's row
policy only lets it read rows of kind `play` and `settings`. So a leaked player
code exposes the plays and the league rules — never the roster, and it cannot be
turned back into a coach code or used to write anything.

**How it behaves**

- Edits go up a few seconds after you make them, and each device pulls every 10
  seconds while the app is on screen — every 60 in the background — as well as
  when it comes back online and when you reopen the app.
- Offline still works. Changes queue on the device and go up next time it has
  internet.
- If two people change the same play, the most recent edit wins. Deletes travel
  too, so removing a play on one device removes it on the others.
- The **coach** code is the key to the team: anyone holding it can read and
  change the plays and roster. The roster holds first names, jersey numbers
  and photos only — no surnames, contacts or medical notes. (The
  player code is read-only and roster-free — see above.) Send it directly
  to the person, don't post it anywhere public, and note that the URL and key
  live only on the paired devices — they are never part of the app's public files.
- **Stop syncing** unpairs one device and leaves everything it has in place.
  Backups keep working exactly as before, synced or not.

## Updating the app

Whenever files change, bump `CACHE` in `sw.js` (e.g. `flagcoach-v2`) before uploading. Next time the device opens the app online, it shows **"A new version is ready → Update"**. Plays, roster and seasons are not affected by updates.

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

Settings → **Save backup** creates one `.json` file (plays, roster, photos, seasons). Save it to iCloud Drive. **Restore from backup** replaces everything on the device with the file's contents.

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
