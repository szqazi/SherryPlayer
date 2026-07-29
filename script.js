/* =========================================================
   Sherry Player
   A local MP3 player. Your music folder is the source of
   truth; song metadata and playlists live in IndexedDB.
   ========================================================= */

/* ---------------------------------------------------------
   1. IndexedDB
--------------------------------------------------------- */
const DB_NAME = 'sherryplayer';
const DB_VER  = 1;
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('meta'))      d.createObjectStore('meta');
      if (!d.objectStoreNames.contains('tracks'))    d.createObjectStore('tracks',    { keyPath: 'path' });
      if (!d.objectStoreNames.contains('playlists')) d.createObjectStore('playlists', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('art'))       d.createObjectStore('art');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function tx(store, mode = 'readonly') {
  return db.transaction(store, mode).objectStore(store);
}
function wrap(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}
const dbGet = (store, key)      => wrap(tx(store).get(key));
const dbAll = (store)           => wrap(tx(store).getAll());
const dbPut = (store, val, key) => wrap(tx(store, 'readwrite').put(val, key));
const dbDel = (store, key)      => wrap(tx(store, 'readwrite').delete(key));

/* ---------------------------------------------------------
   2. State
--------------------------------------------------------- */
const state = {
  mode:        'fs',      // 'fs' = File System Access API, 'legacy' = folder <input>
  dirHandle:   null,
  folderName:  '',
  tracks:      [],        // library, sorted by title
  playlists:   [],
  fileCache:   new Map(), // legacy mode only: path -> File

  queue:       [],        // array of paths
  qIndex:      -1,
  order:       [],        // indices into queue, in play order
  orderPos:    -1,
  source:      '',        // human label for where the queue came from

  shuffle:     false,
  repeat:      'off',     // 'off' | 'all' | 'one'
  currentUrl:  null,
  artUrl:      null,
  openPlaylist: null,
  filter:      ''
};

const audio = document.getElementById('audio');
const $  = (id) => document.getElementById(id);
const el = (sel, root = document) => root.querySelector(sel);

/* ---------------------------------------------------------
   3. ID3 tag reading  (title / artist / cover art)
--------------------------------------------------------- */
function decodeText(bytes, enc) {
  let label = 'iso-8859-1';
  if (enc === 1) label = 'utf-16';      // has a BOM
  else if (enc === 2) label = 'utf-16be';
  else if (enc === 3) label = 'utf-8';
  try {
    return new TextDecoder(label).decode(bytes).replace(/\0+$/, '').trim();
  } catch {
    return '';
  }
}
const synchsafe = (v, o) => (v[o] << 21) | (v[o + 1] << 14) | (v[o + 2] << 7) | v[o + 3];
const uint32    = (v, o) => (v[o] * 0x1000000) + (v[o + 1] << 16) + (v[o + 2] << 8) + v[o + 3];

/** Reads the ID3v2 tag out of the front of the file. */
function parseID3v2(buf) {
  const v = new Uint8Array(buf);
  const out = { title: '', artist: '', art: null, artMime: '' };
  if (v.length < 10 || v[0] !== 0x49 || v[1] !== 0x44 || v[2] !== 0x33) return out; // "ID3"

  const ver   = v[3];
  const flags = v[5];
  const size  = synchsafe(v, 6);
  let pos = 10;

  if (flags & 0x40) {                                     // extended header
    pos += (ver >= 4) ? synchsafe(v, 10) : uint32(v, 10) + 4;
  }

  const end     = Math.min(10 + size, v.length);
  const idLen   = (ver === 2) ? 3 : 4;
  const hdrLen  = (ver === 2) ? 6 : 10;

  while (pos + hdrLen <= end) {
    const id = String.fromCharCode(...v.subarray(pos, pos + idLen));
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;               // padding — done

    let fsize;
    if (ver === 2)      fsize = (v[pos + 3] << 16) | (v[pos + 4] << 8) | v[pos + 5];
    else if (ver === 4) fsize = synchsafe(v, pos + 4);
    else                fsize = uint32(v, pos + 4);

    const dStart = pos + hdrLen;
    const dEnd   = Math.min(dStart + fsize, end);
    if (fsize <= 0 || dStart >= end) break;
    const data = v.subarray(dStart, dEnd);

    if (id === 'TIT2' || id === 'TT2')      out.title  = decodeText(data.subarray(1), data[0]);
    else if (id === 'TPE1' || id === 'TP1') out.artist = decodeText(data.subarray(1), data[0]);
    else if ((id === 'APIC' || id === 'PIC') && !out.art) {
      const pic = parsePicture(data, id === 'PIC');
      if (pic) { out.art = pic.bytes; out.artMime = pic.mime; }
    }

    pos = dStart + fsize;
  }
  return out;
}

function parsePicture(data, isV22) {
  let p = 0;
  const enc = data[p++];
  let mime = '';
  if (isV22) {
    const fmt = String.fromCharCode(data[p], data[p + 1], data[p + 2]).toUpperCase();
    mime = fmt === 'PNG' ? 'image/png' : 'image/jpeg';
    p += 3;
  } else {
    let s = p;
    while (p < data.length && data[p] !== 0) p++;
    mime = String.fromCharCode(...data.subarray(s, p)) || 'image/jpeg';
    p++;                                                  // null terminator
  }
  p++;                                                    // picture type byte

  // description, terminated by 1 null byte (or 2 for UTF-16)
  if (enc === 1 || enc === 2) {
    while (p + 1 < data.length && !(data[p] === 0 && data[p + 1] === 0)) p += 2;
    p += 2;
  } else {
    while (p < data.length && data[p] !== 0) p++;
    p++;
  }
  if (p >= data.length) return null;
  return { bytes: data.slice(p), mime };
}

/** ID3v1 lives in the last 128 bytes. Used only as a fallback. */
function parseID3v1(buf) {
  const v = new Uint8Array(buf);
  if (v.length < 128) return { title: '', artist: '' };
  const o = v.length - 128;
  if (v[o] !== 0x54 || v[o + 1] !== 0x41 || v[o + 2] !== 0x47) return { title: '', artist: '' }; // "TAG"
  const str = (s, len) => new TextDecoder('iso-8859-1')
    .decode(v.subarray(o + s, o + s + len)).replace(/\0.*$/, '').trim();
  return { title: str(3, 30), artist: str(33, 30) };
}

async function readTags(file) {
  const result = { title: '', artist: '', art: null, artMime: '' };
  try {
    const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (head.length === 10 && head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
      const tagSize = synchsafe(head, 6) + 10;
      const buf = await file.slice(0, Math.min(tagSize, file.size)).arrayBuffer();
      Object.assign(result, parseID3v2(buf));
    }
  } catch { /* unreadable tag — fall through to v1 */ }

  if (!result.title || !result.artist) {
    try {
      const tail = await file.slice(Math.max(0, file.size - 128)).arrayBuffer();
      const v1 = parseID3v1(tail);
      if (!result.title)  result.title  = v1.title;
      if (!result.artist) result.artist = v1.artist;
    } catch { /* ignore */ }
  }
  return result;
}

/** Duration via the audio element. Handles VBR files that report Infinity. */
function readDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    let done = false;
    const finish = (d) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      a.src = '';
      resolve(Number.isFinite(d) && d > 0 ? d : 0);
    };
    const timer = setTimeout(() => finish(0), 8000);

    a.preload = 'metadata';
    a.onloadedmetadata = () => {
      if (a.duration === Infinity) {
        a.ontimeupdate = () => { a.ontimeupdate = null; finish(a.duration); };
        a.currentTime = 1e101;               // forces the browser to resolve length
      } else {
        finish(a.duration);
      }
    };
    a.onerror = () => finish(0);
    a.src = url;
  });
}

/* ---------------------------------------------------------
   4. Folder connection & scanning
--------------------------------------------------------- */
const hasFSAccess = typeof window.showDirectoryPicker === 'function';

async function chooseFolder() {
  if (!hasFSAccess) return chooseFolderLegacy();
  let handle;
  try {
    handle = await window.showDirectoryPicker({ id: 'sherry-music', mode: 'readwrite' });
  } catch {
    return;                                   // user cancelled
  }
  state.dirHandle  = handle;
  state.folderName = handle.name;
  state.mode       = 'fs';
  await dbPut('meta', handle, 'dirHandle');
  await dbPut('meta', handle.name, 'folderName');
  await scanFolder();
}

/* Fallback for browsers without the File System Access API. */
function chooseFolderLegacy() {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.webkitdirectory = true;
  input.onchange = async () => {
    const files = [...input.files].filter(f => /\.mp3$/i.test(f.name));
    if (!files.length) { toast('No MP3 files found in that folder.'); return; }
    state.mode = 'legacy';
    state.fileCache.clear();
    const root = files[0].webkitRelativePath.split('/')[0];
    state.folderName = root;
    const list = files.map(f => {
      const path = f.webkitRelativePath.split('/').slice(1).join('/') || f.name;
      state.fileCache.set(path, f);
      return { path, file: f };
    });
    await dbPut('meta', root, 'folderName');
    await ingest(list);
  };
  input.click();
}

async function restoreFolder() {
  const savedName = await dbGet('meta', 'folderName');
  if (savedName) state.folderName = savedName;

  const handle = await dbGet('meta', 'dirHandle');
  state.tracks    = sortTracks(await dbAll('tracks'));
  state.playlists = (await dbAll('playlists')).sort((a, b) => a.name.localeCompare(b.name));

  if (handle && hasFSAccess) {
    state.dirHandle = handle;
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      await scanFolder({ quiet: true });
    } else {
      showReconnectBanner();                 // needs a click to regain access
    }
  } else if (state.tracks.length) {
    state.mode = 'legacy';
    showReconnectBanner();
  }
  renderAll();
}

function showReconnectBanner() {
  const head = el('.folder-line', $('screen-library'));
  const existing = $('reconnectBanner');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.className = 'banner';
  div.id = 'reconnectBanner';
  div.innerHTML = `<span>Reconnect <strong>${escapeHtml(state.folderName || 'your music folder')}</strong> to play songs. Browsers require a click to re-grant folder access after a reload.</span>`;
  const btn = document.createElement('button');
  btn.className = 'btn btn-primary btn-sm';
  btn.textContent = 'Reconnect';
  btn.onclick = async () => {
    if (state.dirHandle && hasFSAccess) {
      const p = await state.dirHandle.requestPermission({ mode: 'readwrite' });
      if (p === 'granted') { div.remove(); await scanFolder(); return; }
    }
    chooseFolder();
  };
  div.appendChild(btn);
  head.insertAdjacentElement('afterend', div);
}

/** Walks the folder (and any subfolders) collecting .mp3 files. */
async function collectFiles(dir, prefix = '') {
  const out = [];
  for await (const [name, handle] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'file') {
      if (/\.mp3$/i.test(name)) out.push({ path, handle });
    } else if (handle.kind === 'directory') {
      out.push(...await collectFiles(handle, path));
    }
  }
  return out;
}

async function scanFolder({ quiet = false } = {}) {
  if (!state.dirHandle) return;
  const banner = $('reconnectBanner');
  if (banner) banner.remove();

  if (!quiet) showScan('Reading folder…', 0, '');
  let found;
  try {
    found = await collectFiles(state.dirHandle);
  } catch (e) {
    hideScan();
    toast('Could not read the folder. Try reconnecting it.');
    showReconnectBanner();
    return;
  }
  const list = [];
  for (const f of found) list.push({ path: f.path, handle: f.handle });
  await ingest(list, { quiet });
}

/**
 * Turns a list of files into library records.
 * Tracks whose size + timestamp are unchanged are left alone, so
 * metadata you edited by hand survives a rescan.
 */
async function ingest(list, { quiet = false } = {}) {
  const known = new Map((await dbAll('tracks')).map(t => [t.path, t]));
  const seen  = new Set();
  const fresh = [];
  const writes = [];        // records to persist
  const artOps = [];        // { path, blob }  — null blob means delete
  let i = 0;

  for (const item of list) {
    i++;
    seen.add(item.path);
    const file = item.file || await item.handle.getFile();
    const prev = known.get(item.path);

    if (prev && prev.size === file.size && prev.lastModified === file.lastModified) {
      fresh.push(prev);
      continue;
    }

    if (!quiet) {
      showScan('Reading song details…', i / list.length, item.path);
    }

    const tags = await readTags(file);
    const rec = {
      path:         item.path,
      title:        (prev && prev.edited ? prev.title  : '') || tags.title  || item.path.replace(/\.mp3$/i, '').split('/').pop(),
      artist:       (prev && prev.edited ? prev.artist : '') || tags.artist || 'Unknown artist',
      edited:       prev ? !!prev.edited : false,
      duration:     await readDuration(file),
      size:         file.size,
      lastModified: file.lastModified,
      hasArt:       !!tags.art,
      addedAt:      prev ? prev.addedAt : Date.now()
    };
    fresh.push(rec);
    writes.push(rec);
    if (tags.art) artOps.push({ path: item.path, blob: new Blob([tags.art], { type: tags.artMime }) });
    else if (prev && prev.hasArt) artOps.push({ path: item.path, blob: null });
  }

  // files that vanished from the folder
  const removed = [...known.keys()].filter(p => !seen.has(p));

  // Single write phase. An IndexedDB transaction closes the moment the event
  // loop yields, so everything above is gathered first and committed here.
  await new Promise((resolve, reject) => {
    const t  = db.transaction(['tracks', 'art'], 'readwrite');
    const ts = t.objectStore('tracks');
    const as = t.objectStore('art');
    for (const rec of writes) ts.put(rec);
    for (const a of artOps) { if (a.blob) as.put(a.blob, a.path); else as.delete(a.path); }
    for (const p of removed) { ts.delete(p); as.delete(p); }
    t.oncomplete = resolve;
    t.onerror    = () => reject(t.error);
    t.onabort    = () => reject(t.error);
  });

  if (removed.length) await removeFromAllPlaylists(removed);

  state.tracks = sortTracks(fresh);
  hideScan();
  renderAll();

  if (!quiet) {
    const n = state.tracks.length;
    toast(`${n} song${n === 1 ? '' : 's'} in ${state.folderName}${removed.length ? ` · ${removed.length} removed` : ''}`);
  }
}

const sortTracks = (arr) => arr.sort((a, b) =>
  a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));

/* ---------------------------------------------------------
   5. File access helpers
--------------------------------------------------------- */
async function getFile(path) {
  if (state.mode === 'legacy') return state.fileCache.get(path) || null;
  if (!state.dirHandle) return null;
  const parts = path.split('/');
  let dir = state.dirHandle;
  for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i]);
  const fh = await dir.getFileHandle(parts[parts.length - 1]);
  return fh.getFile();
}

async function getParentDir(path) {
  const parts = path.split('/');
  let dir = state.dirHandle;
  for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i]);
  return { dir, name: parts[parts.length - 1] };
}

/** Copies MP3s the user picks into the music folder. */
async function addSongs() {
  if (state.mode === 'legacy' || !state.dirHandle) {
    toast('Connect a folder with “Choose music folder” first.');
    return;
  }
  let files;
  try {
    const handles = await window.showOpenFilePicker({
      multiple: true,
      types: [{ description: 'MP3 audio', accept: { 'audio/mpeg': ['.mp3'] } }]
    });
    files = await Promise.all(handles.map(h => h.getFile()));
  } catch {
    return;                                   // cancelled
  }
  files = files.filter(f => /\.mp3$/i.test(f.name));
  if (!files.length) { toast('Nothing to add — MP3 files only.'); return; }

  showScan('Copying into your folder…', 0, '');
  let n = 0;
  for (const file of files) {
    n++;
    showScan('Copying into your folder…', n / files.length, file.name);
    const name = await uniqueName(file.name);
    const fh = await state.dirHandle.getFileHandle(name, { create: true });
    const w  = await fh.createWritable();
    await w.write(file);
    await w.close();
  }
  await scanFolder();
  toast(`Added ${n} song${n === 1 ? '' : 's'}`);
}

async function uniqueName(name) {
  const stem = name.replace(/\.mp3$/i, '');
  let candidate = name, i = 1;
  while (true) {
    try {
      await state.dirHandle.getFileHandle(candidate);
      candidate = `${stem} (${i++}).mp3`;     // taken — try the next one
    } catch {
      return candidate;                        // free
    }
  }
}

async function deleteSong(track) {
  if (state.mode === 'legacy' || !state.dirHandle) {
    toast('Deleting files needs a folder connected via “Choose music folder”.');
    return;
  }
  const ok = await confirmDialog(
    'Delete song?',
    `<p><strong>${escapeHtml(track.title)}</strong><br><span class="muted">${escapeHtml(track.artist)}</span></p>
     <p class="hint">This permanently deletes <code>${escapeHtml(track.path)}</code> from your music folder on disk, and removes it from every playlist. It does not go to the Recycle Bin.</p>`,
    'Delete from disk'
  );
  if (!ok) return;

  try {
    const { dir, name } = await getParentDir(track.path);
    await dir.removeEntry(name);
  } catch (e) {
    toast('Could not delete that file.');
    return;
  }
  await dbDel('tracks', track.path);
  await dbDel('art', track.path);
  await removeFromAllPlaylists([track.path]);
  state.tracks = state.tracks.filter(t => t.path !== track.path);

  if (state.queue[state.qIndex] === track.path) stopPlayback();
  state.queue = state.queue.filter(p => p !== track.path);

  renderAll();
  toast('Deleted');
}

/* ---------------------------------------------------------
   6. Playback
--------------------------------------------------------- */
const trackByPath = (p) => state.tracks.find(t => t.path === p);

function buildOrder(startIndex) {
  const idx = state.queue.map((_, i) => i);
  if (!state.shuffle) {
    state.order = idx;
    state.orderPos = startIndex;
    return;
  }
  const rest = idx.filter(i => i !== startIndex);
  for (let i = rest.length - 1; i > 0; i--) {            // Fisher-Yates
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  state.order = startIndex >= 0 ? [startIndex, ...rest] : rest;
  state.orderPos = 0;
}

async function playQueue(paths, startIndex, sourceLabel) {
  state.queue  = paths.slice();
  state.source = sourceLabel;
  buildOrder(startIndex);
  await playIndex(startIndex);
}

async function playIndex(i) {
  const path = state.queue[i];
  if (!path) return;
  const track = trackByPath(path);
  if (!track) return;

  const file = await getFile(path).catch(() => null);
  if (!file) {
    toast('That file is not reachable. Reconnect your music folder.');
    showReconnectBanner();
    goTo('library');
    return;
  }

  state.qIndex   = i;
  state.orderPos = state.order.indexOf(i);

  if (state.currentUrl) URL.revokeObjectURL(state.currentUrl);
  state.currentUrl = URL.createObjectURL(file);
  audio.src = state.currentUrl;
  audio.play().catch(() => {});

  await paintNowPlaying(track);
  renderLibrary();
  renderQueue();
  renderPlaylistDetail();
}

async function paintNowPlaying(track) {
  $('nowTitle').textContent  = track.title;
  $('nowArtist').textContent = track.artist;
  $('nowSource').textContent = state.source || '';
  $('miniTitle').textContent  = track.title;
  $('miniArtist').textContent = track.artist;
  $('minibar').hidden = false;
  document.body.classList.remove('no-mini');
  document.title = `${track.title} — Sherry Player`;

  if (state.artUrl) { URL.revokeObjectURL(state.artUrl); state.artUrl = null; }
  const art  = $('playerArt');
  const mini = el('.mini-art');
  const blob = track.hasArt ? await dbGet('art', track.path) : null;
  if (blob) {
    state.artUrl = URL.createObjectURL(blob);
    $('playerArtImg').src = state.artUrl;
    $('miniArtImg').src   = state.artUrl;
    art.classList.add('has-art');
    mini.classList.add('has-art');
  } else {
    art.classList.remove('has-art');
    mini.classList.remove('has-art');
  }

  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title, artist: track.artist, album: state.folderName
    });
  }
}

function togglePlay() {
  if (!audio.src) {
    if (state.tracks.length) playQueue(state.tracks.map(t => t.path), 0, 'Library');
    else goTo('library');
    return;
  }
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

function stopPlayback() {
  audio.pause();
  audio.currentTime = 0;
  paintPlayIcon();
}

function nextTrack(auto = false) {
  if (!state.queue.length) return;
  if (auto && state.repeat === 'one') { audio.currentTime = 0; audio.play(); return; }

  const pos = state.orderPos + 1;
  if (pos >= state.order.length) {
    if (state.repeat === 'all') { state.orderPos = -1; return nextTrack(); }
    stopPlayback();                            // reached the end
    return;
  }
  state.orderPos = pos;
  playIndex(state.order[pos]);
}

function prevTrack() {
  if (!state.queue.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }   // restart current
  const pos = state.orderPos - 1;
  if (pos < 0) {
    if (state.repeat === 'all') { state.orderPos = state.order.length; return prevTrack(); }
    audio.currentTime = 0;
    return;
  }
  state.orderPos = pos;
  playIndex(state.order[pos]);
}

const seekBy = (secs) => {
  if (!audio.src || !Number.isFinite(audio.duration)) return;
  audio.currentTime = Math.min(Math.max(0, audio.currentTime + secs), audio.duration);
};

/* ---------------------------------------------------------
   7. Rendering
--------------------------------------------------------- */
function fmtTime(s) {
  if (!Number.isFinite(s) || s <= 0) return '0:00';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const ICONS = {
  play:   '<svg viewBox="0 0 24 24"><path d="M7 4.5l13 7.5-13 7.5z"/></svg>',
  plus:   '<svg viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>',
  edit:   '<svg viewBox="0 0 24 24"><path d="M4 16.5V20h3.5l10-10L14 6.5l-10 10zM19.7 7.3a1 1 0 0 0 0-1.4l-2.1-2.1a1 1 0 0 0-1.4 0L14.6 5.4 18 8.9l1.7-1.6z"/></svg>',
  trash:  '<svg viewBox="0 0 24 24"><path d="M6 7h12l-1 13H7L6 7zm3.5-4h5l1 2H8.5l1-2zM4 5h16v2H4z"/></svg>',
  up:     '<svg viewBox="0 0 24 24"><path d="M12 6l7 8H5z"/></svg>',
  down:   '<svg viewBox="0 0 24 24"><path d="M12 18L5 10h14z"/></svg>',
  minus:  '<svg viewBox="0 0 24 24"><path d="M5 11h14v2H5z"/></svg>',
  note:   '<svg viewBox="0 0 24 24"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>',
  chev:   '<svg viewBox="0 0 24 24" class="pl-chev"><path d="M9 5l7 7-7 7z"/></svg>'
};

function renderAll() {
  renderLibrary();
  renderPlaylists();
  renderPlaylistDetail();
  renderQueue();
  $('folderName').textContent = state.folderName
    ? `Folder: ${state.folderName} · ${state.tracks.length} song${state.tracks.length === 1 ? '' : 's'}`
    : 'No folder connected';
  $('btnAddSongs').disabled = !state.dirHandle || state.mode === 'legacy';
  $('btnRescan').disabled   = !state.dirHandle;
}

/* ---------- Library ---------- */
function renderLibrary() {
  const list = $('libraryList');
  const q = state.filter.trim().toLowerCase();
  const shown = q
    ? state.tracks.filter(t => (t.title + ' ' + t.artist).toLowerCase().includes(q))
    : state.tracks;

  $('libraryEmpty').hidden = state.tracks.length > 0;
  $('btnPlayAll').disabled = shown.length === 0;
  list.innerHTML = '';

  if (state.tracks.length && !shown.length) {
    list.innerHTML = `<li class="empty" style="margin-top:8px">No songs match “${escapeHtml(state.filter)}”.</li>`;
    return;
  }

  const nowPath = state.queue[state.qIndex];
  shown.forEach((t, i) => {
    const li = document.createElement('li');
    li.className = 'track' + (t.path === nowPath ? ' playing' : '');
    li.innerHTML = `
      <span class="track-num">${i + 1}</span>
      <div class="track-main">
        <div class="track-title">${escapeHtml(t.title)}</div>
        <div class="track-artist">${escapeHtml(t.artist)}</div>
      </div>
      <span class="track-dur">${fmtTime(t.duration)}</span>
      <div class="track-actions">
        <button class="icon-btn" data-act="add"  title="Add to playlist">${ICONS.plus}</button>
        <button class="icon-btn" data-act="edit" title="Edit song details">${ICONS.edit}</button>
        <button class="icon-btn danger" data-act="del" title="Delete from folder">${ICONS.trash}</button>
      </div>`;

    el('.track-main', li).onclick = () => {
      const paths = shown.map(x => x.path);
      playQueue(paths, i, q ? `Library · “${state.filter}”` : 'Library');
      goTo('player');
    };
    el('[data-act=add]',  li).onclick = () => addToPlaylistDialog(t);
    el('[data-act=edit]', li).onclick = () => editTrackDialog(t);
    el('[data-act=del]',  li).onclick = () => deleteSong(t);
    list.appendChild(li);
  });
}

/* ---------- Queue on the player screen ---------- */
function renderQueue() {
  const box = $('queueList');
  box.innerHTML = '';
  const upcoming = state.order.slice(state.orderPos + 1, state.orderPos + 21);
  $('queueCount').textContent = state.queue.length
    ? `· ${state.order.length - state.orderPos - 1} left`
    : '';
  if (!upcoming.length) {
    box.innerHTML = `<li class="muted" style="cursor:default">Nothing queued.</li>`;
    return;
  }
  upcoming.forEach(qi => {
    const t = trackByPath(state.queue[qi]);
    if (!t) return;
    const li = document.createElement('li');
    li.innerHTML = `<span class="q-title">${escapeHtml(t.title)}</span>
                    <span class="q-artist">${escapeHtml(t.artist)}</span>`;
    li.onclick = () => { state.orderPos = state.order.indexOf(qi); playIndex(qi); };
    box.appendChild(li);
  });
}

/* ---------- Playlists ---------- */
function renderPlaylists() {
  const list = $('playlistList');
  list.innerHTML = '';
  $('playlistsEmpty').hidden = state.playlists.length > 0;

  state.playlists.forEach(p => {
    const li = document.createElement('li');
    li.className = 'playlist-card';
    li.innerHTML = `
      <div class="pl-icon">${ICONS.note}</div>
      <div class="pl-info">
        <div class="pl-name">${escapeHtml(p.name)}</div>
        <div class="pl-count">${p.paths.length} song${p.paths.length === 1 ? '' : 's'}</div>
      </div>
      ${ICONS.chev}`;
    li.onclick = () => openPlaylist(p.id);
    list.appendChild(li);
  });
}

function openPlaylist(id) {
  state.openPlaylist = id;
  $('plIndex').hidden  = true;
  $('plDetail').hidden = false;
  renderPlaylistDetail();
}
function closePlaylist() {
  state.openPlaylist = null;
  $('plIndex').hidden  = false;
  $('plDetail').hidden = true;
}

function renderPlaylistDetail() {
  const p = state.playlists.find(x => x.id === state.openPlaylist);
  if (!p) { if (state.openPlaylist) closePlaylist(); return; }

  const tracks = p.paths.map(trackByPath).filter(Boolean);
  const total  = tracks.reduce((s, t) => s + (t.duration || 0), 0);
  $('plTitle').textContent = p.name;
  $('plSub').textContent   = `${tracks.length} song${tracks.length === 1 ? '' : 's'}` +
    (total ? ` · ${Math.round(total / 60)} min` : '');
  $('plEmpty').hidden   = tracks.length > 0;
  $('btnPlPlay').disabled = tracks.length === 0;

  const list = $('plTracks');
  list.innerHTML = '';
  const nowPath = state.queue[state.qIndex];

  tracks.forEach((t, i) => {
    const li = document.createElement('li');
    li.className = 'track' + (t.path === nowPath ? ' playing' : '');
    li.innerHTML = `
      <span class="track-num">${i + 1}</span>
      <div class="track-main">
        <div class="track-title">${escapeHtml(t.title)}</div>
        <div class="track-artist">${escapeHtml(t.artist)}</div>
      </div>
      <span class="track-dur">${fmtTime(t.duration)}</span>
      <div class="track-actions">
        <button class="icon-btn" data-act="up"   title="Move up"   ${i === 0 ? 'disabled' : ''}>${ICONS.up}</button>
        <button class="icon-btn" data-act="down" title="Move down" ${i === tracks.length - 1 ? 'disabled' : ''}>${ICONS.down}</button>
        <button class="icon-btn danger" data-act="rm" title="Remove from playlist">${ICONS.minus}</button>
      </div>`;

    el('.track-main', li).onclick = () => {
      playQueue(tracks.map(x => x.path), i, `Playlist · ${p.name}`);
      goTo('player');
    };
    el('[data-act=up]',   li).onclick = () => movePlaylistTrack(p, i, -1);
    el('[data-act=down]', li).onclick = () => movePlaylistTrack(p, i,  1);
    el('[data-act=rm]',   li).onclick = async () => {
      p.paths = p.paths.filter(x => x !== t.path);
      await savePlaylist(p);
      renderPlaylists(); renderPlaylistDetail();
      toast('Removed from playlist');
    };
    list.appendChild(li);
  });
}

async function movePlaylistTrack(p, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= p.paths.length) return;
  [p.paths[i], p.paths[j]] = [p.paths[j], p.paths[i]];
  await savePlaylist(p);
  renderPlaylistDetail();
}

async function savePlaylist(p) {
  p.updatedAt = Date.now();
  await dbPut('playlists', p);
}

async function removeFromAllPlaylists(paths) {
  const set = new Set(paths);
  for (const p of state.playlists) {
    const before = p.paths.length;
    p.paths = p.paths.filter(x => !set.has(x));
    if (p.paths.length !== before) await savePlaylist(p);
  }
}

/* ---------------------------------------------------------
   8. Dialogs
--------------------------------------------------------- */
function openModal({ title, body, buttons, onOpen }) {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML    = body;
  const foot = $('modalFoot');
  foot.innerHTML = '';
  const close = () => { $('modalBackdrop').hidden = true; $('modalBody').innerHTML = ''; };

  buttons.forEach(b => {
    const btn = document.createElement('button');
    btn.className = 'btn ' + (b.cls || '');
    btn.textContent = b.label;
    btn.onclick = () => b.onClick ? b.onClick(close) : close();
    foot.appendChild(btn);
  });
  $('modalBackdrop').hidden = false;
  if (onOpen) onOpen($('modalBody'), close);
}

function confirmDialog(title, body, confirmLabel = 'Confirm') {
  return new Promise(resolve => {
    openModal({
      title, body,
      buttons: [
        { label: 'Cancel', onClick: (c) => { c(); resolve(false); } },
        { label: confirmLabel, cls: 'btn-danger', onClick: (c) => { c(); resolve(true); } }
      ]
    });
  });
}

function editTrackDialog(track) {
  openModal({
    title: 'Edit song details',
    body: `
      <div class="field"><label>Song name</label><input id="fTitle" value="${escapeHtml(track.title)}"></div>
      <div class="field"><label>Artist</label><input id="fArtist" value="${escapeHtml(track.artist)}"></div>
      <div class="hint">File: <code>${escapeHtml(track.path)}</code><br>
      Changes are saved in the player's own database. The MP3 file's own tags are left untouched.</div>`,
    onOpen: (body) => el('#fTitle', body).focus(),
    buttons: [
      { label: 'Cancel' },
      { label: 'Save', cls: 'btn-primary', onClick: async (close) => {
          const t = el('#fTitle').value.trim();
          const a = el('#fArtist').value.trim();
          if (!t) { toast('Song name cannot be empty.'); return; }
          track.title  = t;
          track.artist = a || 'Unknown artist';
          track.edited = true;
          await dbPut('tracks', track);
          state.tracks = sortTracks(state.tracks);
          close();
          renderAll();
          if (state.queue[state.qIndex] === track.path) paintNowPlaying(track);
          toast('Saved');
        }}
    ]
  });
}

function newPlaylistDialog() {
  openModal({
    title: 'New playlist',
    body: `<div class="field"><label>Name</label><input id="fName" placeholder="e.g. Late night drives"></div>`,
    onOpen: (body) => el('#fName', body).focus(),
    buttons: [
      { label: 'Cancel' },
      { label: 'Create', cls: 'btn-primary', onClick: async (close) => {
          const name = el('#fName').value.trim();
          if (!name) { toast('Give the playlist a name.'); return; }
          const p = { id: crypto.randomUUID(), name, paths: [], createdAt: Date.now(), updatedAt: Date.now() };
          await dbPut('playlists', p);
          state.playlists.push(p);
          state.playlists.sort((a, b) => a.name.localeCompare(b.name));
          close();
          renderPlaylists();
          openPlaylist(p.id);
        }}
    ]
  });
}

function renamePlaylistDialog(p) {
  openModal({
    title: 'Rename playlist',
    body: `<div class="field"><label>Name</label><input id="fName" value="${escapeHtml(p.name)}"></div>`,
    onOpen: (body) => el('#fName', body).select(),
    buttons: [
      { label: 'Cancel' },
      { label: 'Save', cls: 'btn-primary', onClick: async (close) => {
          const name = el('#fName').value.trim();
          if (!name) { toast('Give the playlist a name.'); return; }
          p.name = name;
          await savePlaylist(p);
          state.playlists.sort((a, b) => a.name.localeCompare(b.name));
          close();
          renderPlaylists();
          renderPlaylistDetail();
        }}
    ]
  });
}

/** Pick songs from the library to drop into a playlist. */
function addSongsToPlaylistDialog(p) {
  if (!state.tracks.length) { toast('Your library is empty — connect a folder first.'); return; }
  const inList = new Set(p.paths);
  const rows = state.tracks.map(t => `
    <li><label>
      <input type="checkbox" value="${escapeHtml(t.path)}" ${inList.has(t.path) ? 'checked' : ''}>
      <span class="pick-main">
        <span class="pick-title">${escapeHtml(t.title)}</span>
        <span class="pick-artist">${escapeHtml(t.artist)}</span>
      </span>
    </label></li>`).join('');

  openModal({
    title: `Songs in “${p.name}”`,
    body: `<ul class="picklist">${rows}</ul>`,
    buttons: [
      { label: 'Cancel' },
      { label: 'Save', cls: 'btn-primary', onClick: async (close) => {
          const checked = [...document.querySelectorAll('.picklist input:checked')].map(i => i.value);
          const kept  = p.paths.filter(x => checked.includes(x));      // keep existing order
          const added = checked.filter(x => !p.paths.includes(x));
          p.paths = [...kept, ...added];
          await savePlaylist(p);
          close();
          renderPlaylists();
          renderPlaylistDetail();
          toast('Playlist updated');
        }}
    ]
  });
}

/** From the library: put one song into a playlist. */
function addToPlaylistDialog(track) {
  if (!state.playlists.length) {
    openModal({
      title: 'No playlists yet',
      body: `<p>Create a playlist first, then you can add <strong>${escapeHtml(track.title)}</strong> to it.</p>`,
      buttons: [
        { label: 'Cancel' },
        { label: 'New playlist', cls: 'btn-primary', onClick: (c) => { c(); goTo('playlists'); newPlaylistDialog(); } }
      ]
    });
    return;
  }
  const rows = state.playlists.map(p => `
    <li><label>
      <input type="checkbox" value="${p.id}" ${p.paths.includes(track.path) ? 'checked' : ''}>
      <span class="pick-main">
        <span class="pick-title">${escapeHtml(p.name)}</span>
        <span class="pick-artist">${p.paths.length} song${p.paths.length === 1 ? '' : 's'}</span>
      </span>
    </label></li>`).join('');

  openModal({
    title: 'Add to playlist',
    body: `<p class="muted" style="margin:0 0 4px">${escapeHtml(track.title)}</p>
           <ul class="picklist">${rows}</ul>`,
    buttons: [
      { label: 'Cancel' },
      { label: 'Save', cls: 'btn-primary', onClick: async (close) => {
          const checked = new Set([...document.querySelectorAll('.picklist input:checked')].map(i => i.value));
          for (const p of state.playlists) {
            const has = p.paths.includes(track.path);
            if (checked.has(p.id) && !has)      { p.paths.push(track.path); await savePlaylist(p); }
            else if (!checked.has(p.id) && has) { p.paths = p.paths.filter(x => x !== track.path); await savePlaylist(p); }
          }
          close();
          renderPlaylists();
          renderPlaylistDetail();
          toast('Playlist updated');
        }}
    ]
  });
}

/* ---------------------------------------------------------
   9. Overlays
--------------------------------------------------------- */
function showScan(title, ratio, sub) {
  $('scanOverlay').hidden = false;
  $('scanTitle').textContent = title;
  $('scanFill').style.width = `${Math.round(ratio * 100)}%`;
  $('scanSub').textContent = sub || '';
}
const hideScan = () => { $('scanOverlay').hidden = true; };

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
}

/* ---------------------------------------------------------
   10. Navigation
--------------------------------------------------------- */
function goTo(screen) {
  ['player', 'library', 'playlists'].forEach(s => {
    $('screen-' + s).hidden = (s !== screen);
  });
  document.querySelectorAll('.tab').forEach(b =>
    b.classList.toggle('is-active', b.dataset.screen === screen));
  $('main').scrollTop = 0;
}

/* ---------------------------------------------------------
   11. Wiring
--------------------------------------------------------- */
function paintPlayIcon() {
  const playing = !audio.paused && !!audio.src;
  $('iconPlay').classList.toggle('hidden',  playing);
  $('iconPause').classList.toggle('hidden', !playing);
  $('miniIconPlay').classList.toggle('hidden',  playing);
  $('miniIconPause').classList.toggle('hidden', !playing);
}

function bind() {
  document.querySelectorAll('.tab').forEach(b =>
    b.onclick = () => goTo(b.dataset.screen));

  // transport
  $('btnPlay').onclick    = togglePlay;
  $('miniPlay').onclick   = togglePlay;
  $('btnStop').onclick    = stopPlayback;
  $('btnNext').onclick    = () => nextTrack();
  $('miniNext').onclick   = () => nextTrack();
  $('btnPrev').onclick    = prevTrack;
  $('miniPrev').onclick   = prevTrack;
  $('btnRewind').onclick  = () => seekBy(-10);
  $('btnForward').onclick = () => seekBy(10);

  $('btnShuffle').onclick = () => {
    state.shuffle = !state.shuffle;
    $('btnShuffle').classList.toggle('on', state.shuffle);
    $('btnShuffle').setAttribute('aria-pressed', String(state.shuffle));
    buildOrder(state.qIndex);
    renderQueue();
  };
  $('btnRepeat').onclick = () => {
    const modes = ['off', 'all', 'one'];
    state.repeat = modes[(modes.indexOf(state.repeat) + 1) % 3];
    const label = { off: 'Off', all: 'All', one: 'One' }[state.repeat];
    $('btnRepeat').textContent = `Repeat: ${label}`;
    $('btnRepeat').classList.toggle('on', state.repeat !== 'off');
  };

  $('volume').oninput = (e) => { audio.volume = e.target.value / 100; };

  let seeking = false;
  $('seek').oninput  = () => { seeking = true; };
  $('seek').onchange = (e) => {
    if (Number.isFinite(audio.duration)) audio.currentTime = (e.target.value / 1000) * audio.duration;
    seeking = false;
  };
  audio.ontimeupdate = () => {
    if (!seeking && Number.isFinite(audio.duration) && audio.duration > 0) {
      $('seek').value = Math.round((audio.currentTime / audio.duration) * 1000);
    }
    $('timeNow').textContent = fmtTime(audio.currentTime);
  };
  audio.ondurationchange = () => { $('timeTotal').textContent = fmtTime(audio.duration); };
  audio.onplay  = paintPlayIcon;
  audio.onpause = paintPlayIcon;
  audio.onended = () => nextTrack(true);
  audio.onerror = () => { if (audio.src) toast('Could not play that file.'); };

  // library
  $('btnChooseFolder').onclick = chooseFolder;
  $('btnRescan').onclick       = () => scanFolder();
  $('btnAddSongs').onclick     = addSongs;
  $('librarySearch').oninput   = (e) => { state.filter = e.target.value; renderLibrary(); };
  $('btnPlayAll').onclick      = () => {
    const q = state.filter.trim().toLowerCase();
    const shown = q ? state.tracks.filter(t => (t.title + ' ' + t.artist).toLowerCase().includes(q)) : state.tracks;
    if (!shown.length) return;
    playQueue(shown.map(t => t.path), 0, 'Library');
    goTo('player');
  };

  // playlists
  $('btnNewPlaylist').onclick = newPlaylistDialog;
  $('btnPlBack').onclick      = closePlaylist;
  $('btnPlPlay').onclick      = () => {
    const p = state.playlists.find(x => x.id === state.openPlaylist);
    if (!p || !p.paths.length) return;
    playQueue(p.paths.filter(trackByPath), 0, `Playlist · ${p.name}`);
    goTo('player');
  };
  $('btnPlAddSongs').onclick = () => {
    const p = state.playlists.find(x => x.id === state.openPlaylist);
    if (p) addSongsToPlaylistDialog(p);
  };
  $('btnPlRename').onclick = () => {
    const p = state.playlists.find(x => x.id === state.openPlaylist);
    if (p) renamePlaylistDialog(p);
  };
  $('btnPlDelete').onclick = async () => {
    const p = state.playlists.find(x => x.id === state.openPlaylist);
    if (!p) return;
    const ok = await confirmDialog('Delete playlist?',
      `<p>“<strong>${escapeHtml(p.name)}</strong>” will be deleted.</p>
       <p class="hint">The songs themselves stay in your music folder.</p>`, 'Delete playlist');
    if (!ok) return;
    await dbDel('playlists', p.id);
    state.playlists = state.playlists.filter(x => x.id !== p.id);
    closePlaylist();
    renderPlaylists();
    toast('Playlist deleted');
  };

  // modal backdrop click closes
  $('modalBackdrop').onclick = (e) => {
    if (e.target === $('modalBackdrop')) $('modalBackdrop').hidden = true;
  };

  // keyboard
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
    if (typing) {
      if (e.key === 'Enter') {
        const save = [...$('modalFoot').children].find(b => /save|create|delete|confirm/i.test(b.textContent));
        if (save && !$('modalBackdrop').hidden) save.click();
      }
      return;
    }
    if (e.key === 'Escape') { $('modalBackdrop').hidden = true; return; }
    if (!$('modalBackdrop').hidden) return;        // don't drive playback from behind a dialog
    if (e.code === 'Space')      { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowRight') seekBy(10);
    else if (e.key === 'ArrowLeft')  seekBy(-10);
    else if (e.key === 'ArrowUp')    { e.preventDefault(); setVolume(audio.volume + 0.05); }
    else if (e.key === 'ArrowDown')  { e.preventDefault(); setVolume(audio.volume - 0.05); }
    else if (e.key === 'n') nextTrack();
    else if (e.key === 'p') prevTrack();
    else if (e.key === 's') stopPlayback();
  });

  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play',           () => audio.play());
    navigator.mediaSession.setActionHandler('pause',          () => audio.pause());
    navigator.mediaSession.setActionHandler('stop',           stopPlayback);
    navigator.mediaSession.setActionHandler('nexttrack',      () => nextTrack());
    navigator.mediaSession.setActionHandler('previoustrack',  prevTrack);
    navigator.mediaSession.setActionHandler('seekbackward',   () => seekBy(-10));
    navigator.mediaSession.setActionHandler('seekforward',    () => seekBy(10));
  }
}

function setVolume(v) {
  audio.volume = Math.min(1, Math.max(0, v));
  $('volume').value = Math.round(audio.volume * 100);
}

/* ---------------------------------------------------------
   12. Boot
--------------------------------------------------------- */
(async function init() {
  db = await openDB();
  bind();
  document.body.classList.add('no-mini');
  paintPlayIcon();
  goTo('player');
  await restoreFolder();

  if (!hasFSAccess) {
    const head = el('.folder-line', $('screen-library'));
    const div = document.createElement('div');
    div.className = 'banner';
    div.innerHTML = `<span>This browser can't hold on to a folder between visits. You can still browse and play, but you'll need to re-pick the folder each time, and adding or deleting files is disabled. <strong>Chrome or Edge</strong> gives you the full experience.</span>`;
    head.insertAdjacentElement('afterend', div);
  }
})();
