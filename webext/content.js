////////////////////////////////////////////////////////////////
//
// Firemacs prototype: Emacs editing keys in text fields.
//
// <textarea>/<input> are edited through selectionStart/End because
// Selection.modify() does not reach inside text controls.
// contenteditable is edited through Selection.modify(), which
// understands visual lines.
// Modifications go through document.execCommand() to keep the
// native undo history.
//

(() => {
    'use strict';

    const T = FiremacsText;

    const options = {
        useEscape: true,   // ESC as M-
        useAlt: true,      // Alt/Option as M-
        walkForm: true     // C-n/C-p at the end/beginning moves to the next field
    };

    let enabled = true;       // toggled by the toolbar button
    let prefix = '';          // 'C-x ' while waiting for the second key
    let escPending = false;
    let lastCommand = null;   // for C-n/C-p goal column and C-k appending
    let lastState = null;     // where lastCommand left the caret
    let goalColumn = 0;
    let killRing = '';
    const marks = new WeakMap(); // element -> offset (text control) or true (contenteditable)

    ////////////////////////////////////////////////////////////////
    //
    // Echo area
    //

    let echoHost = null;
    let echoBox = null;
    let echoTimer = null;

    const echo = (msg, ms = 1000) => {
        if (!echoHost || !echoHost.isConnected) {
            echoHost = document.createElement('div');
            const root = echoHost.attachShadow({mode: 'closed'});
            echoBox = document.createElement('div');
            echoBox.style.cssText =
                'position:fixed;left:0;bottom:0;z-index:2147483647;' +
                'padding:2px 8px;font:13px monospace;color:#fff;' +
                'background:rgba(0,0,0,.75);pointer-events:none;';
            root.appendChild(echoBox);
            document.documentElement.appendChild(echoHost);
        }
        echoBox.textContent = msg;
        echoBox.style.display = 'block';
        clearTimeout(echoTimer);
        echoTimer = setTimeout(() => { echoBox.style.display = 'none'; }, ms);
    };

    ////////////////////////////////////////////////////////////////
    //
    // Targets
    //

    const TEXT_TYPES = ['text', 'search', 'url', 'tel', 'password'];

    const isTextControl = (el) =>
        el.localName === 'textarea' ||
        (el.localName === 'input' && TEXT_TYPES.includes(el.type));

    const deepActiveElement = () => {
        let el = document.activeElement;
        while (el && el.shadowRoot && el.shadowRoot.activeElement) {
            el = el.shadowRoot.activeElement;
        }
        return el;
    };

    const editableTarget = () => {
        const el = deepActiveElement();
        if (!el || el.disabled || el.readOnly) {
            return null;
        }
        if (isTextControl(el) || el.isContentEditable) {
            return el;
        }
        return null;
    };

    const isVisible = (el) => el.getClientRects().length > 0;

    const walkForm = (el, dir) => {
        const fields = Array.from(document.querySelectorAll(
            'textarea, input, [contenteditable]'))
            .filter(f => (isTextControl(f) || f.isContentEditable) &&
                         !f.disabled && !f.readOnly && isVisible(f));
        const i = fields.indexOf(el);
        if (fields.length < 2 || i < 0) {
            return false;
        }
        fields[(i + dir + fields.length) % fields.length].focus();
        return true;
    };

    ////////////////////////////////////////////////////////////////
    //
    // Text control primitives
    //

    // The mark is dropped when the selection no longer ends at it,
    // i.e. the user or the page moved the caret by other means.
    const markOf = (el) => {
        const m = marks.get(el);
        if (m == null) {
            return null;
        }
        if (el.selectionStart !== m && el.selectionEnd !== m) {
            marks.delete(el);
            return null;
        }
        return m;
    };

    const pointOf = (el) => {
        const m = markOf(el);
        if (m === null) {
            return el.selectionDirection === 'backward'
                ? el.selectionStart : el.selectionEnd;
        }
        return el.selectionStart === m ? el.selectionEnd : el.selectionStart;
    };

    const setPoint = (el, p) => {
        const m = markOf(el);
        if (m === null) {
            el.setSelectionRange(p, p);
        } else if (p < m) {
            el.setSelectionRange(p, m, 'backward');
        } else {
            el.setSelectionRange(m, p, 'forward');
        }
    };

    const replaceRange = (el, s, e, text) => {
        if (s === e && !text) {
            return;
        }
        el.setSelectionRange(s, e);
        const ok = text
            ? document.execCommand('insertText', false, text)
            : document.execCommand('delete');
        if (!ok) {
            el.setRangeText(text, s, e, 'end');
            el.dispatchEvent(new InputEvent('input', {bubbles: true}));
        }
    };

    ////////////////////////////////////////////////////////////////
    //
    // contenteditable primitives
    //

    const ceModify = (el, dir, unit) => {
        getSelection().modify(marks.get(el) ? 'extend' : 'move', dir, unit);
    };

    const ceCollapse = () => {
        const sel = getSelection();
        if (sel.focusNode) {
            sel.collapse(sel.focusNode, sel.focusOffset);
        }
    };

    ////////////////////////////////////////////////////////////////
    //
    // Kill ring (the clipboard, with a local fallback)
    //

    const kill = (text, append) => {
        killRing = append ? killRing + text : text;
        navigator.clipboard.writeText(killRing).catch(() => {});
    };

    const readKill = async () => {
        try {
            return await navigator.clipboard.readText();
        } catch (_) {
            return killRing;
        }
    };

    ////////////////////////////////////////////////////////////////
    //
    // Commands
    //

    const resetMark = (el) => {
        if (isTextControl(el)) {
            const p = pointOf(el);
            marks.delete(el);
            el.setSelectionRange(p, p);
        } else {
            marks.delete(el);
            ceCollapse();
        }
    };

    const moveBy = (fn, dir, unit) => (el) => {
        if (isTextControl(el)) {
            setPoint(el, fn(el.value, pointOf(el)));
        } else {
            ceModify(el, dir, unit);
        }
    };

    const moveLine = (dir) => function lineCommand(el) {
        if (!isTextControl(el)) {
            ceModify(el, dir > 0 ? 'forward' : 'backward', 'line');
            return;
        }
        const t = el.value;
        const p = pointOf(el);
        if (lastCommand !== Commands.NextLine &&
            lastCommand !== Commands.PreviousLine) {
            goalColumn = T.column(t, p);
        }
        const q = dir > 0 ? T.lineNext(t, p, goalColumn)
                          : T.linePrev(t, p, goalColumn);
        if (q !== null) {
            setPoint(el, q);
            return;
        }
        const edge = dir > 0 ? t.length : 0;
        if (p === edge && options.walkForm && markOf(el) === null) {
            walkForm(el, dir);
        } else {
            setPoint(el, edge);
        }
    };

    // Delete [point, fn(point)) or [fn(point), point).
    const deleteBy = (fn, dir, unit, save) => (el) => {
        const append = lastCommand === Commands.KillLineForward;
        if (isTextControl(el)) {
            const t = el.value;
            const p = pointOf(el);
            const q = fn(t, p);
            const [s, e] = p < q ? [p, q] : [q, p];
            marks.delete(el);
            if (save) {
                kill(t.slice(s, e), save === 'append' && append);
            }
            replaceRange(el, s, e, '');
        } else {
            marks.delete(el);
            ceCollapse();
            const sel = getSelection();
            sel.modify('extend', dir, unit);
            if (sel.isCollapsed && unit === 'lineboundary') {
                sel.modify('extend', dir, 'character');   // kill the newline
            }
            if (sel.isCollapsed) {
                return;
            }
            if (save) {
                kill(sel.toString(), save === 'append' && append);
            }
            document.execCommand('delete');
        }
    };

    const regionText = (el) => isTextControl(el)
        ? el.value.slice(el.selectionStart, el.selectionEnd)
        : getSelection().toString();

    const insertText = (el, text) => {
        if (isTextControl(el)) {
            const p = pointOf(el);
            marks.delete(el);
            replaceRange(el, p, p, text);
        } else {
            marks.delete(el);
            ceCollapse();
            document.execCommand('insertText', false, text);
        }
    };

    const Commands = {
        NextChar:     moveBy(T.charNext, 'forward', 'character'),
        PreviousChar: moveBy(T.charPrev, 'backward', 'character'),
        NextWord:     moveBy(T.wordNext, 'forward', 'word'),
        PreviousWord: moveBy(T.wordPrev, 'backward', 'word'),
        BeggingOfLine: moveBy(T.lineStart, 'backward', 'lineboundary'),
        EndOfLine:    moveBy(T.lineEnd, 'forward', 'lineboundary'),
        MoveTop:      moveBy(() => 0, 'backward', 'documentboundary'),
        MoveBottom:   moveBy((t) => t.length, 'forward', 'documentboundary'),
        NextLine:     moveLine(1),
        PreviousLine: moveLine(-1),

        // Arrows are handled only while the mark is active,
        // so that they extend the region like C-f/C-b/C-n/C-p.
        ArrowNextChar:     (el) => marks.has(el) ? Commands.NextChar(el) : false,
        ArrowPreviousChar: (el) => marks.has(el) ? Commands.PreviousChar(el) : false,
        ArrowNextLine:     (el) => marks.has(el) ? Commands.NextLine(el) : false,
        ArrowPreviousLine: (el) => marks.has(el) ? Commands.PreviousLine(el) : false,

        SetMark: (el) => {
            if (isTextControl(el)) {
                const p = pointOf(el);
                marks.set(el, p);
                el.setSelectionRange(p, p);
            } else {
                ceCollapse();
                marks.set(el, true);
            }
            echo('Mark set');
        },
        ResetMark: (el) => {
            resetMark(el);
            echo('Quit');
        },
        SelectAll: (el) => {
            if (isTextControl(el)) {
                marks.set(el, 0);
                el.setSelectionRange(0, el.value.length, 'forward');
            } else {
                document.execCommand('selectAll');
                marks.set(el, true);
            }
        },

        DeleteCharForward:  deleteBy(T.charNext, 'forward', 'character', null),
        DeleteCharBackward: deleteBy(T.charPrev, 'backward', 'character', null),
        DeleteWordForward:  deleteBy(T.wordNext, 'forward', 'word', null),
        DeleteWordBackward: deleteBy(T.wordPrev, 'backward', 'word', null),
        KillLineForward:    deleteBy(T.killLineEnd, 'forward', 'lineboundary', 'append'),
        KillLineBackward:   deleteBy(T.lineStart, 'backward', 'lineboundary', 'kill'),

        KillRegion: (el) => {
            const text = regionText(el);
            if (text === '') {
                echo('The mark is not set now, so there is no region');
                return;
            }
            kill(text, false);
            marks.delete(el);
            document.execCommand('delete');
        },
        Copy: (el) => {
            const text = regionText(el);
            if (text !== '') {
                kill(text, false);
            }
            resetMark(el);
        },
        Paste: (el) => {
            readKill().then(text => {
                if (text) {
                    insertText(el, text);
                }
            });
        },
        OpenLine: (el) => {
            if (isTextControl(el)) {
                const p = pointOf(el);
                insertText(el, '\n');
                el.setSelectionRange(p, p);
            } else {
                insertText(el, '\n');
                getSelection().modify('move', 'backward', 'character');
            }
        },
        Undo: () => {
            document.execCommand('undo');
        }
    };

    // Default keys from chrome/content/db/firemacs.yml (Edit and part of Common).
    const Bindings = {
        'C-p': 'PreviousLine',
        'C-n': 'NextLine',
        'C-b': 'PreviousChar',
        'C-f': 'NextChar',
        'up': 'ArrowPreviousLine',
        'down': 'ArrowNextLine',
        'left': 'ArrowPreviousChar',
        'right': 'ArrowNextChar',
        'C-a': 'BeggingOfLine',
        'C-e': 'EndOfLine',
        'C-SPC': 'SetMark',
        'C-i': 'SetMark',
        'C-w': 'KillRegion',
        'C-k': 'KillLineForward',
        'C-u': 'KillLineBackward',
        'C-y': 'Paste',
        'C-d': 'DeleteCharForward',
        'C-h': 'DeleteCharBackward',
        'C-x u': 'Undo',
        'C-o': 'OpenLine',
        'M-f': 'NextWord',
        'M-b': 'PreviousWord',
        'M-d': 'DeleteWordForward',
        'M-DEL': 'DeleteWordBackward',
        'M-<': 'MoveTop',
        'M->': 'MoveBottom',
        'M-w': 'Copy',
        'C-g': 'ResetMark',
        'C-x h': 'SelectAll'
    };

    ////////////////////////////////////////////////////////////////
    //
    // Key names
    //

    const SPECIAL = {
        ' ': 'SPC',
        'Backspace': 'DEL',
        'Delete': 'DEL',
        'ArrowUp': 'up',
        'ArrowDown': 'down',
        'ArrowLeft': 'left',
        'ArrowRight': 'right'
    };

    // Fallback when Option on Mac turns a key into a symbol.
    const PUNCT = {
        Comma: [',', '<'], Period: ['.', '>'], Slash: ['/', '?'],
        Semicolon: [';', ':'], Quote: ["'", '"'], Minus: ['-', '_'],
        Equal: ['=', '+'], BracketLeft: ['[', '{'], BracketRight: [']', '}'],
        Backslash: ['\\', '|'], Backquote: ['`', '~']
    };

    const baseKey = (e) => {
        if (e.key in SPECIAL) {
            return e.shiftKey ? null : SPECIAL[e.key];
        }
        if (/^[\x21-\x7e]$/.test(e.key)) {
            return e.key;
        }
        const m = /^Key([A-Z])$/.exec(e.code);
        if (m) {
            return e.shiftKey ? m[1] : m[1].toLowerCase();
        }
        const d = /^Digit(\d)$/.exec(e.code);
        if (d) {
            return d[1];
        }
        if (e.code in PUNCT) {
            return PUNCT[e.code][e.shiftKey ? 1 : 0];
        }
        return null;
    };

    const keyName = (e) => {
        if (e.metaKey) {
            return null;                    // Cmd/Win: let the browser win
        }
        if (e.altKey && !options.useAlt) {
            return null;
        }
        const k = baseKey(e);
        if (k === null) {
            return null;
        }
        const meta = e.altKey || escPending;
        return (e.ctrlKey ? 'C-' : '') + (meta ? 'M-' : '') + k;
    };

    const isEscape = (e) =>
        (e.ctrlKey && (e.key === '[' || e.code === 'BracketLeft')) ||
        (options.useEscape && e.key === 'Escape' && !e.ctrlKey && !e.altKey);

    ////////////////////////////////////////////////////////////////
    //
    // Dispatch
    //

    const snapshot = (el) => {
        if (isTextControl(el)) {
            return [el, el.value, el.selectionStart, el.selectionEnd];
        }
        const sel = getSelection();
        return [el, sel.anchorNode, sel.anchorOffset, sel.focusNode, sel.focusOffset];
    };

    const sameState = (a, b) =>
        a !== null && a.length === b.length && a.every((x, i) => x === b[i]);

    const consume = (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
    };

    const onKeyDown = (e) => {
        if (!enabled) {
            return;
        }
        if (!e.isTrusted || e.isComposing || e.keyCode === 229) {
            return;                         // IME is converting
        }
        if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'OS'].includes(e.key)) {
            return;
        }
        const el = editableTarget();
        if (!el) {
            prefix = '';
            escPending = false;
            return;
        }
        if (!escPending && isEscape(e)) {
            escPending = true;
            echo(prefix + 'ESC-');
            consume(e);
            return;
        }
        const k = keyName(e);
        if (k === null) {
            prefix = '';
            escPending = false;
            return;
        }
        if (prefix === '' && k === 'C-x') {
            prefix = 'C-x ';
            escPending = false;
            echo('C-x-');
            consume(e);
            return;
        }
        const full = prefix + k;
        prefix = '';
        escPending = false;
        const name = Bindings[full];
        if (!name) {
            if (full.startsWith('C-x ')) {
                echo(full + ' is undefined');
                consume(e);
            }
            lastCommand = null;
            return;
        }
        const command = Commands[name];
        if (!sameState(lastState, snapshot(el))) {
            lastCommand = null;     // something else happened in between
        }
        if (command(el, e) === false) {
            lastCommand = null;
            return;
        }
        consume(e);
        lastCommand = command;
        lastState = snapshot(el);
    };

    window.addEventListener('keydown', onKeyDown, true);

    const setEnabled = (value) => {
        enabled = value !== false;
        if (!enabled) {
            prefix = '';
            escPending = false;
        }
    };
    browser.storage.local.get('enabled').then(r => setEnabled(r.enabled));
    browser.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && 'enabled' in changes) {
            setEnabled(changes.enabled.newValue);
        }
    });

    // Editing by other means deactivates the mark, as transient-mark-mode.
    window.addEventListener('input', (e) => {
        if (e.isTrusted) {
            marks.delete(e.target);
        }
    }, true);
})();
