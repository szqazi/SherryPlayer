# Sherry Player

A local MP3 player. Point it at one folder of music on your PC and it becomes your library.
It also installs on an Android phone as a PWA — see below.

## Running it on your PC

Double-click **`Start Sherry Player.cmd`**. It starts a small local server and opens
<http://localhost:8130/> in your browser. Leave the black console window open while you listen;
close it when you're done.

Use **Chrome or Edge**. The player needs the File System Access API to remember your music
folder between visits and to add/delete files. Firefox will still play music, but you'll have to
re-pick the folder every time and adding/deleting is turned off.

> It has to run through `http://localhost` rather than by opening `index.html` directly —
> browsers block the database and the folder picker on `file://` pages.

## First run

1. Go to the **Library** tab.
2. Click **Choose music folder** and pick the folder holding your MP3s.
3. Grant access when the browser asks. The player reads every `.mp3` in that folder
   (including subfolders) and pulls the song name and artist out of each file's ID3 tags.

After a reload the browser asks for folder permission again — that's a browser security rule,
not a bug. Click **Reconnect** on the Library tab.

## Installing on your Android phone

The app runs in two storage modes and picks the right one automatically:

| | Desktop Chrome / Edge | Android (and other browsers) |
| --- | --- | --- |
| Storage | stays linked to your music folder | songs are imported into the app |
| Adding | copies files into the folder | **Add songs** imports the MP3s you pick |
| After a reload | asks to reconnect the folder | just works, nothing to reconnect |

Android has no File System Access API, so a phone can't hold a live link to a folder. Instead
the MP3s are copied into the app's own storage, which is what makes the library survive
restarts. Your original files stay where they are.

**Installing requires HTTPS.** A phone can't reach `localhost` on your PC, and Android won't
offer to install a PWA served over plain HTTP. So the files need to sit on an HTTPS host —
GitHub Pages is free and works well. Once they're hosted:

1. Open the site in Chrome on your phone.
2. Menu (⋮) → **Add to Home screen** / **Install app**.
3. Launch it from the home screen. It opens fullscreen with no browser chrome.
4. Go to **Library → Add songs** and pick your MP3s.

Once installed the app shell is cached, so it opens and plays with no connection at all.

## The three tabs

**Player** — cover art, song name, artist, a seek bar, and the transport controls:
previous, rewind 10s, play/pause, stop, forward 10s, next. Plus shuffle, repeat
(off / all / one), volume, and the upcoming queue.

**Library** — every song in your folder.
- Click a song to play it (the whole library becomes the queue)
- **+** adds it to a playlist
- **pencil** edits the song name and artist
- **bin** deletes the file from your folder
- **Add songs** copies MP3s in from anywhere else on your PC
- **Rescan** picks up files you added or removed outside the player
- The filter box narrows by song or artist, and **Play all** queues what's showing

**Playlists** — all your playlists with song counts. Click one to open it, where you can play it,
add songs from your library, reorder with the arrows, remove songs, rename, or delete the
playlist. Deleting a playlist never touches the actual files.

## Keyboard

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `←` `→` | Back / forward 10 seconds |
| `↑` `↓` | Volume |
| `n` / `p` | Next / previous song |
| `s` | Stop |

Media keys on your keyboard work too.

## How your data is stored

Your MP3 files are never modified. The song list, your metadata edits, and your playlists live
in the browser's IndexedDB. On a phone the audio itself is stored there too, so the library
works with the original files nowhere in sight.

Editing a song name or artist changes the player's own record, **not** the tags inside the MP3
file. Those edits survive a rescan — the player only re-reads a file's tags when the file itself
has changed on disk.

Because the database is tied to the browser **and the port**, keep using the same browser and
launch the app the same way. Changing the port hides your library behind a different origin,
which is why `serve.ps1` pins 8130 rather than picking a port automatically. Clearing site
data for `localhost` wipes your playlists.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Screens and controls |
| `style.css` | Styling |
| `script.js` | Tag reading, database, playback, playlists |
| `manifest.json` | Makes it installable as an app |
| `sw.js` | Service worker — caches the app so it opens offline |
| `icon-*.png` | Home screen and tab icons |
| `serve.ps1` | The little local web server |
| `Start Sherry Player.cmd` | Double-click launcher |
