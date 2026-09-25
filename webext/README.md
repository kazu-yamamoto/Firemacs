# Firemacs WebExtension prototype

A prototype to see whether the Edit keybindings of Firemacs can be
implemented on the current Firefox (WebExtensions).

- `text.js`: pure text operations for `<textarea>`/`<input>`
- `content.js`: key handling and commands (content script, all frames)
- `background.js`: the toolbar button toggles Firemacs on/off (gray icon when off)
- `test/index.html`: a test page
- `test/e2e.py`: end-to-end test via Marionette (Python standard library only)

## Try it

1. Open `about:debugging#/runtime/this-firefox`
2. "Load Temporary Add-on..." and choose `webext/manifest.json`
3. Open `webext/test/index.html` (or any page) and edit a text field

## Test

    python3 webext/test/e2e.py            # headless
    python3 webext/test/e2e.py --headed

## Keys

C-f C-b C-n C-p C-a C-e M-f M-b M-< M->, C-SPC (C-i) C-g C-x h,
C-w M-w C-k C-u C-y, C-d C-h M-d M-DEL, C-o, C-x u.
M- is Alt/Option, ESC or C-[. Arrows extend the region while the mark is set.
In a single-line input, or at the end/beginning of a textarea,
C-n/C-p move to the next/previous field.
