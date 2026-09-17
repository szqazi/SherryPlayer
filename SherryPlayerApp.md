### Screens:

There should be three screens for the app, that the user can toggle

&#x09;1. Player: Used to play the songs. Homescreen and the landing page

&#x09;2. Library: List of all songs that the player has

&#x09;3. Playlists: Playlist made by the users



&#x09;\* There should be a Setting (Gear) Icon where the User can update settings for the app

&#x09;

### UI:

&#x09;\* Dark theme, minilmalist UI.

&#x09;\* Look and feel should be the same as in SherryExpenseTracker repo (https://github.com/szqazi/sherry-expense-tracker/blob/main/SherryExpenseTracker.md)

&#x09;\* Fullscreen app shell with no browser chrome once installed (PWA `display: standalone`).

&#x09;\* Safe-area aware layout (notch / home-indicator padding) on iOS.

&#x09;\* Modal dialogs for confirmations (delete song, delete playlist, rename, etc.).

&#x09;\* A scan/progress overlay with a progress bar during folder scans and backup imports.

&#x09;\* Toast notifications for success/failure feedback (e.g. after add/delete/import).





### Player:

&#x09;\* Spotify like player interface: play / pause, rewind , forward (10 secs each), previous next)

&#x09;\* Seek bar with elapsed / total time.

&#x09;\* Repeat: One, all, Off in the form of an icon (as in Spotify). Default is repeat all

&#x09;\* Queue shows the next songs in line 

&#x09;\* Integrates with the OS media session (lock-screen / notification controls, hardware media keys) via the Media Session API.

&#x09;\* No cover art. Instead The Song Name, Artist and Playlist should be visible

&#x09;\* No shuffle icon

&#x09;\* No Volume Bar

### Library:



&#x09;\* Supports mp3 files only

&#x09;\* 





### Playlist:



&#x09;\* Main playlist should show

&#x09;	\* all available playlist.

&#x09;	\* Option to create a "New Playlist"

&#x09;\* For Available playlists:

&#x09;	\* Clicking on any playlist name show all the songs in the playlists.

&#x09;	\* It should also give the option to add / delete / rename playlists.

&#x09;	\* For each song in the playlist: it should also give the option to move it up / down and deleting if from playlist (deletion from playlist needs confirmation)

&#x09;\* The UI should be clear and well spaces for all the info



### Settings:



&#x09;\* Personal Info:

&#x09;	\* Name:

&#x09;	\* Gender: (Give "Male" and Female" as toggle options)

&#x09;	\* Date of Birth:

&#x09;\* Delete (needs confirmation)

&#x09;	\* Delete All playlists

&#x09;	\* Delete Personal Info

&#x09;\* App Settings:

&#x09;	\* Theme. Toggle Dark / Light Mode

&#x09;\* About: (Read Only)

&#x09;	\* App Version

&#x09;	\* Developer Info

&#x09;	\* Share App (Give here the link to the GitHub.io live app which can be used to share with others)



## Backend Features



##### PWA / Offline Support —

### 

the app is installable to the home screen like a native app, and continues to work (viewing and adding entries) without an internet connection

