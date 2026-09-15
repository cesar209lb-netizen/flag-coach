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

## Playbook

The playbook opens on the **formations**, not on every play at once. Each card
draws the alignment and says what you have out of it — `3 pass · 1 run` — so a
formation you have three ways to attack from is obvious next to one you have
only ever thrown from. They are ordered by how many plays they hold, biggest
first, so the formation the team actually lives in is top left. Only formations
you actually run get a card — the rest live in the New Play sheet, where you
pick a starting formation anyway. The search box jumps straight to matching
plays across every formation, and **All N plays** beside it is the
everything-at-once list.

Which formation is open is part of the address (`#/playbook/Trips%20Right`), so
tapping the **Playbook** tab from inside a formation takes you back to the
formations, the iPad's back gesture works, and the page survives a reload.
Coming back from a play lands you on the formation you opened it from — unless
that formation has emptied out since, which sends you to the formations rather
than an empty grid.

Inside a formation the plays are split into labelled **Pass plays** and **Run
plays** blocks, each card tagged PASS or RUN, and the **All / Pass / Run**
filter carries the count of each (picking one collapses to a single grid). A
play counts as a pass if the quarterback throws it at any point — a flea
flicker is a pass; a jet sweep, which only ever gets handed off, is a run.

Flipping a play renames its formation with it ("Trips Right" becomes
"Trips Left"), so a mirrored play gets its own card next to the one it mirrors
rather than hiding inside it.

## Route lab

The **Routes** tab is a standalone drill: one QB, one receiver, and a route.
Drag either player anywhere, tap a route, and press play. The throw is timed so
the ball arrives where the route finishes — a go ball goes deep, a hitch is
thrown at the hitch — and the readout gives the depth and where it was caught.
Out, corner and flat break toward the nearest sideline, so **Flip** or dragging
across the field runs them the other way. Nothing here touches the playbook.

From a tablet up the route list sits beside the field rather than under it, so
all eighteen routes and the drill are on screen together with nothing to
scroll — the field box takes the field's own proportions so it is exactly the
drill and no wasted turf.

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

## Call sheet

Playbook → **Call sheet** picks the plays you are carrying, numbers them for
calling, and prints — Safari's Share → Print, or screenshot it.

Two shapes. **Sheet** is the laminated page: diagrams, formation, tags and
notes, two to four across. **Wristband** is the strip for the plastic window on
a quarterback's arm — numbers and names in two columns, nothing that will not
fit. Defensive calls go on the end of either one.

The field is drawn in a paper palette here: white grass, grey lines. A sheet in
the app's greens comes out of a printer as a page of solid ink.

## Game day

The **Game** tab keeps score and records what you called. Pick a play from the
numbered list, tap Touchdown, Gain, No gain, Loss or Turnover, and that is the
snap logged. Down and distance keep themselves — the chains move, downs
advance, four and out starts a new series — and **Undo last** fixes a wrong tap.

Those results come back to the playbook: a play carries its real average and
touchdown count next to its rating, so you can see whether the thing that works
in the simulation works against people.

Games sync between coaches and ride along in backups. Player devices never
receive them.

## Defensive playbook

Playbook has an **Offense / Defense** toggle. A defensive call is five
defenders you drag to where they line up, each with a job: rush, man on a
receiver, or a short or deep zone. The picture carries the assignment — a
dashed line to whoever a man defender has, an ellipse for a zone — over a
ghosted offence in whichever formation you want to see it against.

**Show the team** puts it full screen with every assignment written across the
top, which is the whiteboard picture without the whiteboard.

These are not the same thing as the coverages in the play designer. Those are
opponents the simulator invents to test an offensive play against. These are
the defence you actually run and teach.

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
| `js/views/*` | Home, Playbook, Play editor, Huddle, Roster, Settings, Call sheet, Game day, Defense |
| `js/qr.js` | QR encoder for join links, so invites work with no signal |
| `sw.js` | Offline cache |
