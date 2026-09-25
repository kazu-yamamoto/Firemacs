# Firemacs

Emacs keybindings for Firefox: Emacs editing in text fields, and
Emacs/vi-like scrolling and tab switching elsewhere.

Firemacs is now a WebExtension, in [`webext/`](webext/). It runs on
Firefox 115 and later (tested with Firefox 156 on macOS, Windows 11 and
Ubuntu 24.04). It is a prototype and is not on addons.mozilla.org yet.

The rest of this repository (`chrome/`, `components/`, `install.rdf`) is the
original XUL extension for Firefox 30 and earlier. It does not run on
Firefox 57 and later and is kept for history.

## Install

Until Firemacs is signed and published, load it as a temporary add-on:

1. Open `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on..." and choose `webext/manifest.json`

A temporary add-on is removed when Firefox quits.

## Keys

| Where | Keys |
|---|---|
| Text fields | C-f C-b C-n C-p C-a C-e M-f M-b M-< M->, C-SPC C-w M-w C-k C-u C-y, C-d C-h M-d M-DEL, C-o, C-x u |
| Elsewhere | j/k C-n/C-p (line), u/b (page), M-</M-> (top/bottom), h/l C-b/C-f (tab), B/F/R (back/forward/reload) |
| Both | C-s/C-r (incremental search), C-x b (switch tab), C-v/M-v, C-g, C-x h, C-x k, C-M-u/C-M-t (copy URL/title), C-x C-e (web search), ... |

M- is Alt (Option), ESC or C-[. Every key and all options of the original
Firemacs can be changed on the options page (right click the toolbar button).
See [`webext/README.md`](webext/README.md) for the full list.

## Limitations

- On Windows and Linux, Firefox keeps Ctrl+N and Ctrl+W for itself, so
  **C-n and C-w do not work there**. No extension can take these keys. On Mac
  they are Command keys, so Ctrl is free.
- Extensions cannot move the focus to the URL bar or the search bar, or open
  the file dialog: C-x l, C-x g and C-x C-f of the original are gone.
- Firemacs does not work on pages where Firefox allows no extensions
  (`about:` pages, addons.mozilla.org, the PDF viewer, ...).

## Development

    python3 webext/test/e2e.py            # end-to-end tests (Marionette)

`webext/test/reserved_keys.py` checks which keys reach Firemacs with real OS
input on Windows and Linux.

## Author

Kazu Yamamoto
