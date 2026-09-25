# Firemacs WebExtension

Firemacs for the current Firefox (WebExtensions). All commands of the
original that extensions can implement are here: Edit, View, Common,
incremental search, tab switching and the options page. It is still a
prototype: not signed, and not on addons.mozilla.org.

- `defaults.js`: default options and keys (from `firemacs.yml`)
- `options.html`, `options.js`: the options page
- `text.js`: pure text operations for `<textarea>`/`<input>`
- `visual.js`: visual (wrapped) lines of a `<textarea>` for `C-n`/`C-p`
- `minibuffer.js`: the minibuffer (prompt, `<input>` and candidate list) at the bottom of the page
- `content.js`: key handling and commands (content script, all frames)
- `background.js`: the toolbar button toggles Firemacs on/off (gray icon when off),
  right click opens the options; tabs, history, search and downloads
- `test/*.html`: test pages
- `test/e2e.py`: end-to-end test via Marionette (Python standard library only)
- `test/reserved_keys.py`: which keys reach Firemacs, with real OS input
  (xdotool on Linux, keybd_event on Windows)

## Try it

1. Open `about:debugging#/runtime/this-firefox`
2. "Load Temporary Add-on..." and choose `webext/manifest.json`
3. Open `webext/test/index.html` (or any page) and edit a text field

## Test

    python3 webext/test/e2e.py            # headless
    python3 webext/test/e2e.py --headed

## Keys

In text fields:

`C-f` `C-b` `C-n` `C-p` `C-a` `C-e` `M-f` `M-b` `M-<` `M->`, `C-SPC` (`C-i`),
`C-w` `C-k` `C-u` `C-y`, `C-d` `C-h` `M-d` `M-DEL`, `C-o`, `C-x u`.
`M-` is Alt/Option, `ESC` or `C-[`. Arrows extend the region while the mark is set.
In a textarea, `C-n`/`C-p` move by visual (wrapped) lines, keeping the column in
pixels, as the down/up keys do; at the end of a wrapped line they stop before
the wrap, as Emacs does.
In a single-line input, or at the end/beginning of a textarea,
`C-n`/`C-p` move to the next/previous field.

Outside text fields (View):

`j`/`k` `C-n`/`C-p` (line), `H`/`L` (left/right), `u`/`b` (page),
`<`/`>` `M-<`/`M->` (top/bottom), `l`/`h` `C-f`/`C-b` (next/previous tab),
`B`/`F` (back/forward), `R` (reload).
The scroll target is the scrollable box last clicked or focused,
the document, or the largest scrollable box when the document does not scroll.
Fields such as email, number and select keep their keys.

Both (Common):

`C-v`/`M-v` (page), `C-g` (quit), `M-w` (copy), `C-x h` (select all),
`C-x t` (first text field), `C-x s` / `M-n` / `M-p` (buttons), `C-x .` (focus body),
`C-M-f` (next tab), `C-x k` (close tab), `M-k` (kill access keys),
`C-m` (`RET`), `C-M-u` / `C-M-t` / `C-M-b` (copy URL / title / both),
`C-x C-e` (web search), `C-x C-a` (map search), `C-x C-s` (save page, HTML only).
`C-s`/`C-r` (incremental search), `C-x b` (switch tab).
Impossible for extensions: `C-x l`, `C-x g`, `C-x C-f`.

Minibuffer (`C-s`/`C-r`, `C-x b`):

The input is a real `<input>`, so IME works, and Edit keys work in it.
`RET` accepts, `C-g` cancels (`C-s`/`C-r` restores the scroll position),
`ESC` accepts a search and cancels `C-x b`.
`C-s`/`C-r` go to the next/previous match, and wrap around after a failure.
Search is smart-case, over the visible text; all matches are highlighted.
`C-x b` lists tabs, most recently used first; space-separated words filter them,
and `C-n`/`C-p` (`C-s`/`C-r`, arrows) choose one.

## Windows and Linux

Firefox keeps some keys for itself (reserved keys): `Ctrl+N` (new window),
`Ctrl+T` (new tab), `Ctrl+W` (close tab), `Ctrl+Shift+W` (close window),
`Ctrl+Shift+P` (new private window), and `Ctrl+Q` on Linux or `Ctrl+Shift+Q`
on Windows (quit).  Their key events never reach pages or extensions, and
extension shortcuts ("commands") do not take them either, so no WebExtension
can use them.  On Mac these are Command keys, and Ctrl is free.

With the default keys, this means **`C-n`** (NextLine, ScrollLineDown) and
**`C-w`** (KillRegion) do not work on Windows and Linux.  Every other default key
was checked with real OS input on Windows 11 and Ubuntu 24.04 (Firefox 156):
see `test/reserved_keys.py`.  The options page marks commands bound to reserved
keys on those systems; bind them to other keys if you need them (the down arrow
still moves to the next line natively).

## Options

Right click the toolbar button, or about:addons, to open the options page.
All options of the original Firemacs are available (UseEscape, UseAlt, UseMeta,
XPrefix, AccessRegex, TurnoffRegex, WalkForm, EditOnly), and every key can be
changed; an empty key disables the command.  Invalid keys, duplicates in a group
and bad regular expressions are reported before saving; keys reserved by Firefox
on Windows and Linux are warned about.  Only the differences
from the defaults are stored, and open pages pick up changes at once.
