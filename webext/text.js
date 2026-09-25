////////////////////////////////////////////////////////////////
//
// Pure text operations for <textarea> and <input>.
// Positions are UTF-16 offsets into the value.
// Lines are logical lines separated by '\n' (not visual lines).
//

const FiremacsText = (() => {
    const WORD = /[\p{L}\p{N}_]/u;
    const isWord = (t, p) => WORD.test(t.charAt(p));

    const lineStart = (t, p) => t.lastIndexOf('\n', p - 1) + 1;

    const lineEnd = (t, p) => {
        const i = t.indexOf('\n', p);
        return i < 0 ? t.length : i;
    };

    const column = (t, p) => p - lineStart(t, p);

    const charNext = (t, p) => {
        if (p >= t.length) {
            return p;
        }
        return p + (t.codePointAt(p) > 0xffff ? 2 : 1);
    };

    const charPrev = (t, p) => {
        if (p <= 0) {
            return p;
        }
        const c = t.charCodeAt(p - 1);
        return (c >= 0xdc00 && c <= 0xdfff && p >= 2) ? p - 2 : p - 1;
    };

    // null means there is no next/previous line.
    const lineNext = (t, p, goal) => {
        const e = lineEnd(t, p);
        if (e >= t.length) {
            return null;
        }
        const s = e + 1;
        return Math.min(s + goal, lineEnd(t, s));
    };

    const linePrev = (t, p, goal) => {
        const s = lineStart(t, p);
        if (s === 0) {
            return null;
        }
        const ps = lineStart(t, s - 1);
        return Math.min(ps + goal, s - 1);
    };

    const wordNext = (t, p) => {
        while (p < t.length && !isWord(t, p)) p++;
        while (p < t.length && isWord(t, p)) p++;
        return p;
    };

    const wordPrev = (t, p) => {
        while (p > 0 && !isWord(t, p - 1)) p--;
        while (p > 0 && isWord(t, p - 1)) p--;
        return p;
    };

    // C-k: to the end of line, or the newline itself at the end of line.
    const killLineEnd = (t, p) => {
        const e = lineEnd(t, p);
        return (e === p && p < t.length) ? p + 1 : e;
    };

    return {
        lineStart, lineEnd, column, charNext, charPrev,
        lineNext, linePrev, wordNext, wordPrev, killLineEnd
    };
})();
