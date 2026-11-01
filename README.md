# electerm widget: MobaXterm Import

Reads MobaXterm sessions and offers them as electerm bookmarks. Nothing is
added until you press **Import bookmarks** in the widget panel.

Needs an electerm with widget bookmark offers (a config-mode widget result
may carry `bookmarks: { bookmarks, bookmarkGroups }`).

## Install

electerm › Widgets › import, pick this folder (or the git repository).

## Use

1. **MobaXterm file**: `MobaXterm.ini` or a `.mxtsessions` export (MobaXterm ›
   Sessions › Export). Empty: `%APPDATA%\MobaXterm\MobaXterm.ini`; the
   portable MobaXterm keeps the file next to its exe.
2. **Bookmark group**: new group for the sessions, default `MobaXterm <date>`.
   MobaXterm folders become subgroups.
3. **Read sessions**, check the list, **Import bookmarks**.

## What is imported

| MobaXterm | electerm |
|---|---|
| SSH | host, port, user, X11, private key path, command after login, SSH agent / agent forwarding, gateways as connection hopping |
| SFTP | SSH bookmark, SFTP only |
| Telnet | host, port |
| RDP | host, port, user, gateways |
| VNC | host, port, scaling, view only |
| comment | description |

Other session types (shell, WSL, serial, FTP, browser, ...) are listed as not
supported. Passwords are not in the file, electerm asks on first connect.

The session format is not documented by Mobatek, field positions follow
https://gist.github.com/Ruzgfpegk/ab597838e4abbe8de30d7224afd062ea
(MobaXterm 23.6+). Key path placeholders: `_ProfileDir_` → `~`,
`_CurrentDrive_` → `C:`.

## Test

    node --test test.js
