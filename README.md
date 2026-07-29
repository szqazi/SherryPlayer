# Sherry Player

A local MP3 player. Point it at one folder of music on your PC and it becomes your library.

## Running it

Double-click **`Start Sherry Player.cmd`**. It starts a small local server and opens
<http://localhost:8123/> in your browser. Leave the black console window open while you listen;
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

Your MP3 files are the source of truth and are never modified. The song list, your metadata
edits, and your playlists live in the browser's IndexedDB under `http://localhost:8123`.

Editing a song name or artist changes the player's own record, **not** the tags inside the MP3
file. Those edits survive a rescan — the player only re-reads a file's tags when the file itself
has changed on disk.

Because the database is tied to the browser and the port, keep using the same browser and
launch the app the same way. Clearing site data for `localhost` wipes your playlists.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Screens and controls |
| `style.css` | Styling |
| `script.js` | Tag reading, database, playback, playlists |
| `serve.ps1` | The little local web server |
| `Start Sherry Player.cmd` | Double-click launcher |
