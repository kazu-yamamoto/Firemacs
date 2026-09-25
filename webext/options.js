////////////////////////////////////////////////////////////////
//
// Options page: options and keys, validated as they are typed.
// Saved as {options, keys} in storage.local; content scripts
// pick them up through storage.onChanged.
//

(async () => {
    'use strict';

    const D = FiremacsDefaults;
    const $ = (id) => document.getElementById(id);
    const defaults = {
        options: Object.assign({}, D.options),
        keys: Object.fromEntries(D.commands.map(([, name, key]) => [name, key]))
    };
    let saved = await D.load();
    // ?os=win or ?os=linux shows the page as on that system (for tests).
    const os = new URLSearchParams(location.search).get('os') ||
               (await browser.runtime.getPlatformInfo()).os;
    const reserved = D.reservedKeysFor(os);
    const reservedNote = (key) => {
        const t = key.split(' ').find(k => k in reserved);
        return t ? t + ' is kept by Firefox for "' + reserved[t] +
                   '" on this system, so it never reaches Firemacs' : '';
    };

    const normalizeKey = (key) => key.trim().replace(/\s+/g, ' ');

    ////////////////////////////////////////////////////////////////
    //
    // Building the page
    //

    for (const [name, value] of Object.entries(D.options)) {
        const desc = D.optionDescriptions[name];
        const div = document.createElement('div');
        div.className = 'opt';
        if (typeof value === 'boolean') {
            const label = document.createElement('label');
            label.className = 'check';
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.id = 'opt-' + name;
            label.append(box, name + ': ' + desc);
            div.append(label);
        } else {
            const label = document.createElement('label');
            label.className = 'label';
            label.htmlFor = 'opt-' + name;
            label.textContent = name + ': ' + desc;
            const input = document.createElement('input');
            input.className = 'text';
            input.id = 'opt-' + name;
            input.spellcheck = false;
            const problem = document.createElement('div');
            problem.className = 'problem';
            problem.id = 'problem-opt-' + name;
            div.append(label, input, problem);
        }
        $('options').append(div);
    }

    for (const [group, name, , desc] of D.commands) {
        const tr = document.createElement('tr');
        tr.id = 'row-' + name;
        const tdName = document.createElement('td');
        tdName.className = 'name';
        tdName.textContent = name;
        const tdKey = document.createElement('td');
        tdKey.className = 'key';
        const input = document.createElement('input');
        input.className = 'key';
        input.id = 'key-' + name;
        input.spellcheck = false;
        input.setAttribute('aria-label', name);
        tdKey.append(input);
        const tdDesc = document.createElement('td');
        tdDesc.className = 'desc';
        const problem = document.createElement('div');
        problem.className = 'problem';
        problem.id = 'problem-' + name;
        tdDesc.append(desc, problem);
        tr.append(tdName, tdKey, tdDesc);
        $(group).append(tr);
    }

    ////////////////////////////////////////////////////////////////
    //
    // Reading, writing and checking the form
    //

    const fill = (settings) => {
        for (const [name, value] of Object.entries(settings.options)) {
            const el = $('opt-' + name);
            if (el && el.type === 'checkbox') {
                el.checked = value;
            } else if (el) {
                el.value = value;
            }
        }
        for (const [name, key] of Object.entries(settings.keys)) {
            const el = $('key-' + name);
            if (el) {
                el.value = key;
            }
        }
    };

    const read = () => {
        const options = {};
        for (const [name, value] of Object.entries(D.options)) {
            const el = $('opt-' + name);
            options[name] = typeof value === 'boolean' ? el.checked : el.value.trim();
        }
        const keys = {};
        for (const [, name] of D.commands) {
            keys[name] = normalizeKey($('key-' + name).value);
        }
        return {options, keys};
    };

    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    let warnings = 0;      // keys kept by Firefox, counted by validate()

    // Returns 1 for an error; a warning (level 'warning') does not stop saving.
    const setProblem = (input, problemId, message, level = 'error') => {
        const error = message !== '' && level === 'error';
        const warning = message !== '' && level === 'warning';
        input.classList.toggle('invalid', error);
        input.classList.toggle('warning', warning);
        $(problemId).classList.toggle('warning', warning);
        $(problemId).textContent = message;
        return error ? 1 : 0;
    };

    // Returns the number of problems.
    const validate = ({options, keys}) => {
        let problems = 0;

        const xprefix = options.XPrefix;
        const xprefixOk = D.isValidKey(xprefix) && !xprefix.includes(' ');
        if (xprefixOk && reservedNote(xprefix)) {
            setProblem($('opt-XPrefix'), 'problem-opt-XPrefix', reservedNote(xprefix), 'warning');
        } else {
            problems += setProblem($('opt-XPrefix'), 'problem-opt-XPrefix',
                                   xprefixOk ? '' : 'Not a single key, e.g. C-x or C-t');
        }
        for (const name of ['AccessRegex', 'TurnoffRegex']) {
            let message = '';
            try {
                new RegExp(options[name]);
            } catch (e) {
                message = 'Invalid regular expression: ' + e.message;
            }
            problems += setProblem($('opt-' + name), 'problem-opt-' + name, message);
        }

        // The key as it is dispatched, after the prefix substitution.
        const effective = (key) =>
            (xprefixOk && key.startsWith('C-x ')) ? xprefix + key.slice(3) : key;
        const byGroup = {};
        const prefixes = new Set();
        for (const [group, name] of D.commands) {
            const key = keys[name];
            if (key !== '' && D.isValidKey(key)) {
                const k = effective(key);
                (byGroup[group] = byGroup[group] || {})[k] =
                    (byGroup[group][k] || []).concat(name);
                if (k.includes(' ')) {
                    prefixes.add(k.split(' ')[0]);
                }
            }
        }
        warnings = 0;
        for (const [group, name] of D.commands) {
            const key = keys[name];
            let message = '';
            let level = 'error';
            if (key !== '' && !D.isValidKey(key)) {
                message = 'Invalid key';
            } else if (key !== '') {
                const k = effective(key);
                const others = byGroup[group][k].filter(n => n !== name);
                if (others.length > 0) {
                    message = 'Also bound to ' + others.join(', ');
                } else if (prefixes.has(k)) {
                    message = k + ' is a prefix key';
                } else if (reservedNote(k)) {
                    message = reservedNote(k);
                    level = 'warning';
                    warnings++;
                }
            }
            problems += setProblem($('key-' + name), 'problem-' + name, message, level);
            $('row-' + name).classList.toggle('changed', key !== saved.keys[name]);
        }
        return problems;
    };

    const status = (message, error = false) => {
        $('status').textContent = message;
        $('status').classList.toggle('error', error);
    };

    const update = (message) => {
        const current = read();
        const problems = validate(current);
        const dirty = !same(current, saved);
        $('save').disabled = problems > 0 || !dirty;
        if (problems > 0) {
            status(problems + (problems === 1 ? ' problem' : ' problems') +
                   ' to fix before saving', true);
        } else if (message) {
            status(message);
        } else if (dirty) {
            status('Unsaved changes');
        } else {
            status(warnings ? warnings + (warnings === 1 ? ' key does' : ' keys do') +
                   ' not reach Firemacs on this system' : '');
        }
    };

    document.addEventListener('input', () => update());
    document.addEventListener('change', () => update());

    $('save').addEventListener('click', async () => {
        const current = read();
        if (validate(current) > 0) {
            return;
        }
        // Only the differences from the defaults, so that changed defaults
        // reach the commands left alone.
        const diff = (obj, base) => Object.fromEntries(
            Object.entries(obj).filter(([k, v]) => v !== base[k]));
        await browser.storage.local.set({
            options: diff(current.options, defaults.options),
            keys: diff(current.keys, defaults.keys)
        });
        saved = current;
        fill(saved);
        update('Saved');
    });

    $('reset').addEventListener('click', () => {
        fill(defaults);
        update(same(read(), saved) ? '' : 'Defaults restored; press Save to keep them');
    });

    if (Object.keys(reserved).length > 0) {
        $('reserved').textContent = 'On this system Firefox keeps ' +
            Object.entries(reserved).map(([k, what]) => k + ' (' + what + ')').join(', ') +
            ' for itself: pages and extensions ' +
            'never see them, so commands bound to them (marked below) do not work. ' +
            'Bind those commands to other keys if you need them.';
        $('reserved').hidden = false;
    }

    fill(saved);
    update();
})();
