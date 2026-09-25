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

    // Fields that take typed keys but are not edited by Firemacs
    // (email, number, date, select, ...).  View keys must not steal them.
    const NON_TYPING_TYPES = ['checkbox', 'radio', 'button', 'submit', 'reset',
                              'image', 'file', 'range', 'color'];

    const takesKeys = () => {
        const el = deepActiveElement();
        if (!el) {
            return false;
        }
        return el.localName === 'select' || el.localName === 'textarea' ||
            (el.localName === 'input' && !NON_TYPING_TYPES.includes(el.type)) ||
            el.localName === 'embed' || el.localName === 'object' ||
            el.isContentEditable;
    };

    const isVisible = (el) => el.getClientRects().length > 0;

    const textFields = () => Array.from(document.querySelectorAll(
        'textarea, input, [contenteditable]'))
        .filter(f => (isTextControl(f) || f.isContentEditable) &&
                     !f.disabled && !f.readOnly && isVisible(f));

    const buttons = () => Array.from(document.querySelectorAll(
        'button, input[type=submit], input[type=image], input[type=file], ' +
        'input[type=button], input[type=reset]'))
        .filter(b => !b.disabled && isVisible(b));

    // Focus the element dir steps away from the focused one.
    // With dir 0, stay if already on one of them, or go to the first.
    const cycleFocus = (elements, dir, errmsg) => {
        if (elements.length === 0) {
            echo(errmsg);
            return;
        }
        const i = elements.indexOf(deepActiveElement());
        const n = elements.length;
        const next = (i < 0) ? (dir < 0 ? n - 1 : 0) : (i + dir + n) % n;
        elements[next].focus();
    };

    const walkForm = (el, dir) => {
        const fields = textFields();
        if (fields.length < 2 || !fields.includes(el)) {
            return;
        }
        cycleFocus(fields, dir);
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

    // Edit keys from chrome/content/db/firemacs.yml.
    const EditBindings = {
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
        'M->': 'MoveBottom'
    };

    ////////////////////////////////////////////////////////////////
    //
    // Scrolling
    //
    // The target is the scrollable ancestor of the last clicked or
    // focused element, the document, or the largest scrollable element
    // when the document itself does not scroll (e.g. app-like pages).
    //

    const LINE = 40;          // px per line

    let lastClicked = null;
    window.addEventListener('mousedown', (e) => {
        lastClicked = e.composedPath()[0];
    }, true);

    const canScroll = (el, vertical) => {
        const overflow = getComputedStyle(el)[vertical ? 'overflowY' : 'overflowX'];
        if (overflow !== 'auto' && overflow !== 'scroll') {
            return false;
        }
        return vertical ? el.scrollHeight > el.clientHeight
                        : el.scrollWidth > el.clientWidth;
    };

    const rootCanScroll = (root, vertical) => vertical
        ? root.scrollHeight > root.clientHeight
        : root.scrollWidth > root.clientWidth;

    const largestScrollable = (vertical) => {
        let best = null;
        let area = 0;
        for (const el of document.querySelectorAll('body *')) {
            const a = el.clientWidth * el.clientHeight;
            if (a > area && canScroll(el, vertical)) {
                best = el;
                area = a;
            }
        }
        return best;
    };

    const scrollTarget = (vertical) => {
        const root = document.scrollingElement || document.documentElement;
        let el = (lastClicked && lastClicked.isConnected) ? lastClicked
                                                          : deepActiveElement();
        for (; el && el !== root && el !== document.body; el = el.parentElement) {
            if (el.nodeType === Node.ELEMENT_NODE && canScroll(el, vertical)) {
                return el;
            }
        }
        if (rootCanScroll(root, vertical)) {
            return root;
        }
        return largestScrollable(vertical) || root;
    };

    const scrollByLines = (dx, dy) => () => {
        scrollTarget(dy !== 0).scrollBy({left: dx * LINE, top: dy * LINE, behavior: 'instant'});
    };

    const scrollByPage = (dir) => () => {
        const el = scrollTarget(true);
        const root = document.scrollingElement || document.documentElement;
        const height = el === root ? window.innerHeight : el.clientHeight;
        el.scrollBy({top: dir * Math.max(height - 2 * LINE, LINE), behavior: 'instant'});
    };

    const scrollToEdge = (dir) => () => {
        const el = scrollTarget(true);
        el.scrollTo({top: dir > 0 ? el.scrollHeight : 0, behavior: 'instant'});
    };

    // Tabs and history are handled by the background script.
    const background = (command, arg) => () => {
        browser.runtime.sendMessage({command, arg});
    };

    const ViewCommands = {
        ScrollLineUp:     scrollByLines(0, -1),
        ScrollLineDown:   scrollByLines(0, 1),
        ViScrollLineUp:   scrollByLines(0, -1),
        ViScrollLineDown: scrollByLines(0, 1),
        ViScrollLeft:     scrollByLines(-1, 0),
        ViScrollRight:    scrollByLines(1, 0),
        ViScrollPageUp:   scrollByPage(-1),
        ViScrollPageDown: scrollByPage(1),
        ViScrollTop:      scrollToEdge(-1),
        ViScrollBottom:   scrollToEdge(1),
        ScrollTop:        scrollToEdge(-1),
        ScrollBottom:     scrollToEdge(1),
        PreviousTab:      background('moveTab', -1),
        NextTab:          background('moveTab', 1),
        ViPreviousTab:    background('moveTab', -1),
        ViNextTab:        background('moveTab', 1),
        PreviousPage:     background('goBack'),
        NextPage:         background('goForward'),
        ReloadPage:       background('reload')
    };

    // View keys from firemacs.yml.
    const ViewBindings = {
        'C-p': 'ScrollLineUp',
        'C-n': 'ScrollLineDown',
        'C-b': 'PreviousTab',
        'C-f': 'NextTab',
        'k': 'ViScrollLineUp',
        'j': 'ViScrollLineDown',
        'H': 'ViScrollLeft',
        'L': 'ViScrollRight',
        'h': 'ViPreviousTab',
        'l': 'ViNextTab',
        'b': 'ViScrollPageUp',
        'u': 'ViScrollPageDown',
        'B': 'PreviousPage',
        'F': 'NextPage',
        'R': 'ReloadPage',
        '<': 'ViScrollTop',
        '>': 'ViScrollBottom',
        'M-<': 'ScrollTop',
        'M->': 'ScrollBottom'
    };

    ////////////////////////////////////////////////////////////////
    //
    // Common commands: in text fields and while viewing.
    // el is the edited field, or null while viewing.
    //

    const selectedText = (el) => (el && isTextControl(el))
        ? el.value.slice(el.selectionStart, el.selectionEnd)
        : getSelection().toString();

    const copyText = (text, msg) => {
        kill(text, false);
        echo(msg, 2000);
    };

    const copyTabInfo = (format, msg) => () => {
        browser.runtime.sendMessage({command: 'tabInfo'}).then(tab => {
            copyText(format(tab), msg);
        });
    };

    const withSelection = (command) => (el) => {
        const text = selectedText(el).trim();
        if (text === '') {
            echo('No selection');
            return;
        }
        browser.runtime.sendMessage({command, arg: text});
    };

    // Emulates RET: page handlers see a synthetic Enter first; if none of
    // them cancels it, do what Enter would do.  Synthetic key events are
    // untrusted, so Firefox itself never acts on them.
    const pressEnter = (el) => {
        const target = el || deepActiveElement() || document.body;
        const init = {key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
                      bubbles: true, cancelable: true, composed: true};
        const down = new KeyboardEvent('keydown', init);
        const accepted = target.dispatchEvent(down) &&
                         target.dispatchEvent(new KeyboardEvent('keypress', init));
        target.dispatchEvent(new KeyboardEvent('keyup', init));
        if (!accepted) {
            return;
        }
        if (el && el.localName === 'textarea') {
            insertText(el, '\n');
        } else if (el && isTextControl(el)) {
            if (el.form) {
                el.form.requestSubmit();
            }
        } else if (el) {
            marks.delete(el);
            document.execCommand('insertParagraph');
        } else if (target !== document.body) {
            target.click();
        }
    };

    const CommonCommands = {
        AllTabs: null,          // TODO: needs its own UI
        SearchForward: null,    // TODO: needs its own UI
        SearchBackword: null,   // TODO: needs its own UI
        ScrollPageUp: scrollByPage(-1),
        ScrollPageDown: scrollByPage(1),
        ResetMark: (el) => {
            if (el) {
                Commands.ResetMark(el);
            } else {
                getSelection().removeAllRanges();
                echo('Quit');
            }
        },
        JumpURLBar: null,       // impossible: no API to focus the URL bar
        JumpSearchBar: null,    // impossible: no API to focus the search bar
        FocusBody: () => {
            const el = deepActiveElement();
            if (el && el.blur) {
                el.blur();
            }
            window.top.focus();
            echo('The body was focused');
        },
        JumpInput: () => cycleFocus(textFields(), 0, 'No input/text area'),
        JumpSubmit: () => cycleFocus(buttons(), 0, 'No submit button'),
        CmPreviousTab: background('moveTab', -1),
        CmNextTab: background('moveTab', 1),
        CloseTab: background('closeTab'),
        OpenFile: null,         // impossible: no API to open the file dialog
        Copy: (el) => {
            if (el) {
                Commands.Copy(el);
            } else {
                const text = selectedText(null);
                if (text !== '') {
                    kill(text, false);
                }
                getSelection().removeAllRanges();
            }
        },
        NextButton: () => cycleFocus(buttons(), 1, 'No submit button'),
        PreviousButton: () => cycleFocus(buttons(), -1, 'No submit button'),
        KillAccessKeys: () => {
            const nodes = document.querySelectorAll('[accesskey]');
            nodes.forEach(n => n.removeAttribute('accesskey'));
            echo(nodes.length + ' accesskeys were canceled');
        },
        NewLine: pressEnter,
        CopyUrl: copyTabInfo(t => t.url, 'URL copied'),
        CopyTitle: copyTabInfo(t => t.title, 'Title copied'),
        CopyTitleAndUrl: copyTabInfo(t => t.title + '\n' + t.url, 'Title and URL copied'),
        WebSearch: withSelection('webSearch'),
        MapSearch: withSelection('mapSearch'),
        SavePage: background('savePage'),
        SelectAll: (el) => {
            if (el) {
                Commands.SelectAll(el);
            } else if (document.body) {
                getSelection().selectAllChildren(document.body);
            }
        }
    };

    // Common keys from firemacs.yml.  C-M-b was bound to both CmPreviousTab
    // and CopyTitleAndUrl; the latter won in the original, and does here.
    const CommonBindings = {
        'C-x b': 'AllTabs',
        'C-s': 'SearchForward',
        'C-r': 'SearchBackword',
        'M-v': 'ScrollPageUp',
        'C-v': 'ScrollPageDown',
        'C-g': 'ResetMark',
        'C-x l': 'JumpURLBar',
        'C-x g': 'JumpSearchBar',
        'C-x .': 'FocusBody',
        'C-x t': 'JumpInput',
        'C-x s': 'JumpSubmit',
        'C-M-f': 'CmNextTab',
        'C-x k': 'CloseTab',
        'C-x C-f': 'OpenFile',
        'M-w': 'Copy',
        'M-n': 'NextButton',
        'M-p': 'PreviousButton',
        'M-k': 'KillAccessKeys',
        'C-m': 'NewLine',
        'C-M-u': 'CopyUrl',
        'C-M-t': 'CopyTitle',
        'C-M-b': 'CopyTitleAndUrl',
        'C-x C-e': 'WebSearch',
        'C-x C-a': 'MapSearch',
        'C-x C-s': 'SavePage',
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
        const el = editableTarget();       // null while viewing
        if (!el && takesKeys()) {
            prefix = '';
            escPending = false;
            return;
        }
        if (!escPending && isEscape(e)) {
            escPending = true;
            echo(prefix + 'ESC-');
            if (el || e.ctrlKey) {
                consume(e);      // a plain ESC still reaches the page while viewing
            }
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
        const name = (el ? EditBindings : ViewBindings)[full];
        const common = CommonCommands[CommonBindings[full]];
        if (!name && common) {
            common(el);
            consume(e);
            lastCommand = null;
            return;
        }
        if (!name) {
            if (full.startsWith('C-x ')) {
                echo(full + ' is undefined');
                consume(e);
            }
            lastCommand = null;
            return;
        }
        if (!el) {
            ViewCommands[name]();
            consume(e);
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
