# Firemacs WebExtension prototype

A prototype to see whether the Edit keybindings of Firemacs can be
implemented on the current Firefox (WebExtensions).

- `text.js`: pure text operations for `<textarea>`/`<input>`
- `content.js`: key handling and commands (content script, all frames)
- `background.js`: the toolbar button toggles Firemacs on/off (gray icon when off)
- `test/index.html`, `test/view.html`, `test/app.html`: test pages
- `test/e2e.py`: end-to-end test via Marionette (Python standard library only)

## Try it

1. Open `about:debugging#/runtime/this-firefox`
2. "Load Temporary Add-on..." and choose `webext/manifest.json`
3. Open `webext/test/index.html` (or any page) and edit a text field

## Test

    python3 webext/test/e2e.py            # headless
    python3 webext/test/e2e.py --headed

## Keys

In text fields:

C-f C-b C-n C-p C-a C-e M-f M-b M-< M->, C-SPC (C-i),
C-w C-k C-u C-y, C-d C-h M-d M-DEL, C-o, C-x u.
M- is Alt/Option, ESC or C-[. Arrows extend the region while the mark is set.
In a single-line input, or at the end/beginning of a textarea,
C-n/C-p move to the next/previous field.

Outside text fields (View):

j/k C-n/C-p (line), H/L (left/right), u/b (page),
</> M-</M-> (top/bottom), l/h C-f/C-b (next/previous tab),
B/F (back/forward), R (reload).
The scroll target is the scrollable box last clicked or focused,
the document, or the largest scrollable box when the document does not scroll.
Fields such as email, number and select keep their keys.

Both (Common):

C-v/M-v (page), C-g (quit), M-w (copy), C-x h (select all),
C-x t (first text field), C-x s / M-n / M-p (buttons), C-x . (focus body),
C-M-f (next tab), C-x k (close tab), M-k (kill access keys),
C-m (RET), C-M-u / C-M-t / C-M-b (copy URL / title / both),
C-x C-e (web search), C-x C-a (map search), C-x C-s (save page, HTML only).
Not yet: C-s/C-r (search), C-x b (tab list).
Impossible for extensions: C-x l, C-x g, C-x C-f.
