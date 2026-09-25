////////////////////////////////////////////////////////////////
//
// Visual lines of a <textarea>, for C-n/C-p.
//
// There is no API for the caret position in a textarea, so a hidden
// copy of the text is laid out with the same width and font, and
// positions are measured with Range rects.
//
// The position of offset i is the left edge of the character at i, so
// that at a wrap the offset belongs to the next line; this is where
// setSelectionRange() shows the caret.  Each logical line of the copy
// ends with a zero width space, which gives the end of a line (and an
// empty line) a character to measure.
//

const FiremacsVisual = (() => {
    const PROPS = [
        'font-family', 'font-size', 'font-style', 'font-weight', 'font-variant',
        'font-stretch', 'font-feature-settings', 'font-variation-settings',
        'font-kerning', 'font-size-adjust', 'line-height', 'letter-spacing',
        'word-spacing', 'text-transform', 'text-indent', 'text-align',
        'text-rendering', 'tab-size', 'white-space', 'white-space-collapse',
        'text-wrap-mode', 'overflow-wrap', 'word-break', 'line-break', 'hyphens',
        'direction', 'unicode-bidi', 'writing-mode',
        'padding-left', 'padding-right', 'padding-top', 'padding-bottom'
    ];

    // Lays out the logical lines in [from, to] of el's value.
    // {pos(i) -> {x, top, bottom} | null, done()} for offsets i in [from, to].
    const measure = (el, from, to) => {
        const cs = getComputedStyle(el);
        const host = document.createElement('div');
        host.style.cssText = 'all: initial; position: absolute; left: 0; top: 0;' +
                             'width: 0; height: 0; overflow: hidden;';
        const root = host.attachShadow({mode: 'closed'});
        const div = document.createElement('div');
        for (const p of PROPS) {
            div.style.setProperty(p, cs.getPropertyValue(p));
        }
        div.style.position = 'absolute';
        div.style.visibility = 'hidden';
        div.style.boxSizing = 'content-box';
        div.style.border = '0';
        div.style.margin = '0';
        div.style.height = 'auto';
        div.style.width = (el.clientWidth - parseFloat(cs.paddingLeft) -
                           parseFloat(cs.paddingRight)) + 'px';
        if (from > 0) {
            div.style.textIndent = '0';     // only the first line is indented
        }
        const value = el.value.slice(from, to);
        // One text node per logical line: [line + ZWSP] '\n' [line + ZWSP] ...
        const nodes = [];
        const starts = [];
        let offset = from;
        value.split('\n').forEach((line, k) => {
            if (k > 0) {
                div.append('\n');
            }
            const node = document.createTextNode(line + '\u200b');
            div.append(node);
            nodes.push(node);
            starts.push(offset);
            offset += line.length + 1;
        });
        root.append(div);
        (document.body || document.documentElement).append(host);

        const range = document.createRange();
        const pos = (i) => {
            // The logical line of offset i.
            let lo = 0;
            let hi = starts.length - 1;
            while (lo < hi) {
                const mid = (lo + hi + 1) >> 1;
                if (starts[mid] <= i) {
                    lo = mid;
                } else {
                    hi = mid - 1;
                }
            }
            const node = nodes[lo];
            const c = i - starts[lo];
            range.setStart(node, c);
            range.setEnd(node, FiremacsText.charNext(node.data, c));
            const rects = range.getClientRects();
            const r = rects.length ? rects[rects.length - 1] : null;
            return r && {x: r.left, top: r.top, bottom: r.bottom};
        };
        return {pos, done: () => host.remove()};
    };

    // Smallest i in [lo, hi) with pred(i), or hi.
    const search = (lo, hi, pred) => {
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (pred(mid)) {
                hi = mid;
            } else {
                lo = mid + 1;
            }
        }
        return lo;
    };

    // Moves offset p of el to the next (dir > 0) or previous visual line,
    // as close to goalX (or the current x) as possible.
    // Returns {q, x}, null when there is no such line, or undefined when
    // the textarea cannot be measured (e.g. not rendered).
    const lineMove = (el, p, dir, goalX) => {
        const value = el.value;
        const n = value.length;
        // Wrapping of a logical line does not depend on the others, so only
        // the current line and the next (or previous) one are laid out.
        const T = FiremacsText;
        const start = T.lineStart(value, p);
        const end = T.lineEnd(value, p);
        const from = (dir < 0 && start > 0) ? T.lineStart(value, start - 1) : start;
        const to = (dir > 0 && end < n) ? T.lineEnd(value, end + 1) : end;
        const m = measure(el, from, to);
        try {
            const cur = m.pos(p);
            if (!cur || cur.bottom === cur.top) {
                return undefined;
            }
            const x = goalX == null ? cur.x : goalX;
            const half = (cur.bottom - cur.top) / 2;
            const top = (i) => m.pos(i).top;
            let s;
            let e;
            if (dir > 0) {
                s = search(p + 1, to + 1, i => top(i) > cur.top + half);
                if (s > to) {
                    return null;
                }
                const lineTop = top(s);
                e = search(s, to + 1, i => top(i) > lineTop + half) - 1;
            } else {
                e = search(from, p, i => top(i) > cur.top - half) - 1;
                if (e < from) {
                    return null;
                }
                const lineTop = top(e);
                s = search(from, e + 1, i => top(i) > lineTop - half);
            }
            // x grows along a line.
            let q = search(s, e + 1, i => m.pos(i).x >= x);
            if (q > e) {
                q = e;
            } else if (q > s && x - m.pos(q - 1).x < m.pos(q).x - x) {
                q = q - 1;
            }
            // Not inside a surrogate pair.
            const c = value.charCodeAt(q);
            if (c >= 0xdc00 && c <= 0xdfff && q > s) {
                q = q - 1;
            }
            return {q, x};
        } finally {
            m.done();
        }
    };

    return {lineMove};
})();
