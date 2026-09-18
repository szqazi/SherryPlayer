# Sherry Player — Requirements / Feature Spec

A local MP3 player, installable as a PWA on desktop and mobile. Point it at one folder of
music and it becomes your library — no accounts, no server, no upload.

---

### Screens

Three tabs at the bottom: **Player**, **Library**, **Playlists**. A gear icon, fixed at the
top right on every screen, opens **Settings**.

- Default (home) tab on launch is **Player**.
- A **mini player bar** stays visible above the tab bar on every screen except Player (which
  already has full transport controls) whenever a song is loaded — Library, Playlists, and
  Settings — showing a small thumbnail, title, artist, and prev/play-pause/next, so playback is
  never out of reach while browsing.

---

### Storage Model

The app runs in two modes and picks the right one automatically based on browser capability:

| | Desktop Chrome / Edge | Android (and other browsers) |
| --- | --- | --- |
| Storage | stays linked to your music folder (File System Access API) | songs are imported and copied into the app's own storage |
| Adding a song | copies the file into the folder | **Add songs** imports the MP3s you pick |
| Deleting a song | deletes the file from the folder | removes it from the app's storage |
| After a reload | asks to reconnect the folder (browser security rule) — **Reconnect** button on Library | nothing to reconnect, just works |

- Your original files on disk are never modified — the player only reads them and reads/writes
  its own database.
- The database (song list, metadata edits, playlists, and on Android the audio itself) lives in
  the browser's **IndexedDB**.
- The database is tied to both the **browser** and the **port** it's served on — changing the
  port is a different origin with an empty library, which is why the local server pins a fixed
  port (8130) instead of auto-picking one.

---

### UI

- Dark theme by default, minimalist; a Light theme is available from Settings.
- Fullscreen app shell with no browser chrome once installed (PWA `display: standalone`).
- Safe-area aware layout (notch / home-indicator padding) on iOS.
- Modal dialogs for confirmations (delete song, delete playlist, remove from playlist, rename,
  delete-all-playlists, delete-personal-info, etc.).
- A scan/progress overlay with a progress bar during folder scans and backup imports.
- Toast notifications for success/failure feedback (e.g. after add/delete/import).

---

### Player Tab

- No cover art. Shows song title, artist, and a "now playing source" line (Library, or
  `Playlist · <name>`).
- Seek bar with elapsed / total time.
- Transport controls: previous, rewind 10s, play/pause, forward 10s, next. No Stop button — use
  the `s` key or a media-session stop action.
- **Repeat** icon (Spotify-style, no text label) cycling Off → All → One, with a small "1"
  badge in One mode. Defaults to **All**. No shuffle, no volume slider.
- **Up next** queue list showing what's coming after the current track.
- Integrates with the OS media session (lock-screen / notification controls, hardware media
  keys) via the Media Session API.

---

### Library Tab

- Shows every song currently in the connected folder (desktop) or imported into the app
  (Android).
- Toolbar:
  - **Choose music folder** — opens the folder picker (desktop) and starts a scan.
  - **Add songs** — pick individual MP3 files to import/copy in.
  - **Rescan** — re-reads the connected folder to pick up files added/removed outside the app.
  - **Back up** — exports the library (songs, metadata edits, playlists) to a file.
  - **Restore** — re-imports a previously exported backup.
- Search box filters the list live by song name or artist.
- **Play all** queues everything currently shown by the filter.
- A song that came from the bundled starter library shows a small box icon before its title
  (both here and in playlist detail views), so it reads apart from songs added personally.
- Per-song row actions:
  - Click the row to play it (the whole visible library becomes the queue).
  - **+** — add the song to a playlist.
  - **pencil** — edit the song's display name and artist.
  - **bin** — delete the file (from the folder on desktop, from app storage on Android).
- On first load, or after a scan, the player reads every `.mp3` in the folder (including
  subfolders) and pulls song name/artist from each file's ID3 tags.
- Editing a song's name/artist changes only the player's own record, never the tags inside the
  MP3 file itself. Edits survive a rescan — a file's tags are only re-read when the file itself
  has changed on disk.

---

### Starter Library

The app can ship with a bundled set of songs (see `starter-songs/`) so it isn't empty on first
open.

- On first launch, if no folder has ever been connected and the library is empty, the app fetches
  `starter-songs/manifest.json` and imports the listed MP3s the same way **Add songs** does.
- The manifest is organized by subfolder: `[{ "name": "Chill", "files": ["a.mp3", "b.mp3"] }, …]`,
  with files at `starter-songs/<name>/<file>`. Each subfolder becomes both a set of imported
  songs and a playlist named after that folder.
- Runs at most once, ever — tracked by a flag in IndexedDB. Deleting the starter songs afterward
  does not bring them back; connecting a real folder first skips seeding entirely.
- If `starter-songs/manifest.json` isn't present (no starter library bundled) or the device is
  offline on that first launch, nothing happens and it's retried on a later launch instead of
  being permanently skipped.

---

### Playlists Tab

- Index view: grid of all playlists with their song counts. **New playlist** creates one.
- Detail view (opened by clicking a playlist):
  - **Play** — queues the whole playlist.
  - **Add songs** — pull tracks in from the Library.
  - **Rename** playlist.
  - **Delete** playlist (confirmation required; never touches the actual files).
  - Reorder tracks with up/down arrows.
  - Remove a song from the playlist (confirmation required; does not delete the underlying
    file).
  - **‹ Playlists** back button returns to the index view.

---

### Settings

Opened via the gear icon, with a **‹ Back** button that returns to whichever tab was open
before. All fields save immediately (no separate Save button) and confirm with a toast.

- **Personal info** — Name (text), Gender (Male / Female toggle), Date of birth (date picker).
  Stored in IndexedDB.
- **App settings** — Theme toggle, Dark / Light. Applied instantly and persisted in
  `localStorage`, with an inline pre-paint script so a saved Light theme never flashes dark on
  load.
- **Delete** (both require confirmation):
  - **Delete all playlists** — clears every playlist; the songs themselves are untouched.
  - **Delete personal info** — clears name, gender, and date of birth.
- **About** (read-only):
  - App version
  - Developer
  - **Share app** — the live GitHub Pages URL, with a **Copy** button.

---

### Backup / Restore

- **Back up** exports the library database (song metadata, edits, playlists — and on Android,
  the audio itself) to a portable file the user saves.
- **Restore** re-imports that file, with a progress overlay while it processes.
- Intended as the way to move a library between browsers/devices, or recover after clearing
  site data.

---

### Keyboard

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `←` `→` | Back / forward 10 seconds |
| `↑` `↓` | Volume (no visible slider — the level itself has no on-screen indicator) |
| `n` / `p` | Next / previous song |
| `s` | Stop |

Hardware media keys (keyboard, headset, lock screen) also control playback via the Media
Session API.

---

### PWA / Installability

- Installable to the home screen / desktop like a native app via `manifest.json`.
- Service worker (`sw.js`) caches the app shell so it opens and plays with no network connection
  once installed.
- **Installing on Android requires HTTPS** — a phone can't reach `localhost` on a PC, and
  Android won't offer to install a PWA served over plain HTTP. The app is hosted on GitHub
  Pages for this purpose: <https://szqazi.github.io/SherryPlayer/>.
- iOS: safe-area-aware layout plus a dedicated home-screen icon (`icon-apple-180.png`) and
  status-bar styling meta tags.
- App icons: `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (Android adaptive icon),
  `icon-apple-180.png` (iOS home screen).

---

### Running Locally (Windows)

- Double-click **`Start Sherry Player.cmd`** — starts a small local PowerShell server
  (`serve.ps1`, pinned to port 8130) and opens `http://localhost:8130/` in the default browser.
- Must be served over `http://localhost` rather than opened as a `file://` page — browsers
  block IndexedDB and the folder picker on `file://`.
- Requires **Chrome or Edge** for full functionality (File System Access API). Firefox plays
  music but can't remember the folder between visits and can't add/delete files.

---

### Files

| File | Purpose |
| --- | --- |
| `index.html` | Screens and controls |
| `style.css` | Styling |
| `script.js` | Tag reading, database, playback, playlists, backup/restore |
| `manifest.json` | Makes it installable as an app |
| `sw.js` | Service worker — caches the app so it opens offline |
| `icon-*.png` | Home screen and tab icons |
| `serve.ps1` | The local web server |
| `Start Sherry Player.cmd` | Double-click launcher |
| `songsDB/` | Sample/test MP3s (git-ignored) |

---

### Out of Scope (for now)

- Native app wrapper (Android/iOS) — removed in favor of PWA-only distribution.
- Cloud sync / account sign-in — library is local-only, per browser/device, moved via
  Backup/Restore.

---

> This file mirrors the app's current, implemented behavior. The canonical requirements doc
> going forward is [`SherryPlayerApp.md`](SherryPlayerApp.md).
