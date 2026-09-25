////////////////////////////////////////////////////////////////
//
// Minibuffer: a prompt and an <input> at the bottom of the page,
// with an optional list of candidates above it.
// A real <input> is used so that IME works.
// It lives in a closed shadow root so that page CSS does not apply.
//
// Keys are dispatched by content.js; this file only draws and focuses.
//

const FiremacsMinibuffer = (() => {
    let host = null;
    let promptEl = null;
    let input = null;
    let list = null;
    let handlers = null;       // non-null while open
    let previousFocus = null;

    const CSS = `
        .frame { position: fixed; left: 0; right: 0; bottom: 0;
                 z-index: 2147483647; font: 13px/1.5 monospace;
                 color: #eee; background: #222; box-shadow: 0 -1px 4px rgba(0,0,0,.4); }
        .list { max-height: 40vh; overflow-y: auto; margin: 0; padding: 0; }
        .list:empty { display: none; }
        .item { display: flex; gap: 1em; padding: 1px 8px; white-space: nowrap; }
        .item.selected { background: #456; }
        .text { overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; }
        .sub { overflow: hidden; text-overflow: ellipsis; flex: 1 1 0; color: #999; }
        .line { display: flex; padding: 2px 8px; }
        .prompt { white-space: pre; color: #9cf; }
        input { all: unset; flex: 1; color: #fff; font: inherit; }
    `;

    const deepActiveElement = () => {
        let el = document.activeElement;
        while (el && el.shadowRoot && el.shadowRoot.activeElement) {
            el = el.shadowRoot.activeElement;
        }
        return el;
    };

    const build = () => {
        if (host && host.isConnected) {
            return;
        }
        host = document.createElement('div');
        host.style.cssText = 'all: initial; display: none;';
        const root = host.attachShadow({mode: 'closed'});
        const style = document.createElement('style');
        style.textContent = CSS;
        const frame = document.createElement('div');
        frame.className = 'frame';
        list = document.createElement('div');
        list.className = 'list';
        const line = document.createElement('div');
        line.className = 'line';
        promptEl = document.createElement('span');
        promptEl.className = 'prompt';
        input = document.createElement('input');
        input.spellcheck = false;
        input.autocomplete = 'off';
        line.append(promptEl, input);
        frame.append(list, line);
        root.append(style, frame);
        input.addEventListener('input', () => {
            if (handlers && handlers.onInput) {
                handlers.onInput(input.value);
            }
        });
        input.addEventListener('blur', () => {
            // Focus moved elsewhere (a click, another window, ...).
            if (handlers) {
                const h = handlers;
                close(null);
                if (h.onBlur) {
                    h.onBlur();
                }
            }
        });
        document.documentElement.appendChild(host);
    };

    // handlers: {onInput(value), onKey(name) -> handled?, onAccept(),
    //            onCancel(), onBlur(), escape: 'accept' | 'cancel'}
    const open = (prompt, h, value = '') => {
        build();
        previousFocus = deepActiveElement();
        handlers = h;
        promptEl.textContent = prompt;
        input.value = value;
        list.replaceChildren();
        host.style.display = 'block';
        input.focus();
    };

    // focus: an element to focus, 'previous', or null to leave the page body.
    const close = (focus = 'previous') => {
        if (!handlers) {
            return;
        }
        handlers = null;
        input.blur();
        host.style.display = 'none';
        const target = focus === 'previous' ? previousFocus : focus;
        previousFocus = null;
        if (target && target !== document.body && target.isConnected) {
            target.focus();
        }
    };

    const setPrompt = (prompt) => {
        promptEl.textContent = prompt;
    };

    // items: [{text, sub}]
    const setItems = (items, selected) => {
        list.replaceChildren(...items.map((item, i) => {
            const row = document.createElement('div');
            row.className = 'item' + (i === selected ? ' selected' : '');
            const text = document.createElement('span');
            text.className = 'text';
            text.textContent = item.text;
            const sub = document.createElement('span');
            sub.className = 'sub';
            sub.textContent = item.sub || '';
            row.append(text, sub);
            return row;
        }));
        const row = list.children[selected];
        if (row) {
            row.scrollIntoView({block: 'nearest'});
        }
    };

    return {
        open,
        close,
        setPrompt,
        setItems,
        isOpen: () => handlers !== null,
        isFocused: () => handlers !== null && document.activeElement === host,
        handlers: () => handlers,
        input: () => input,
        value: () => input.value,
        setValue: (v) => { input.value = v; },
        contains: (node) => node === host
    };
})();
