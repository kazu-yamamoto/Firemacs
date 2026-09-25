////////////////////////////////////////////////////////////////
//
// Default settings, from chrome/content/db/firemacs.yml.
// Shared by the content script, the background script and the options page.
//
// Keys: 'C-f', 'M-f', 'C-M-f', 'SPC', 'DEL', 'up', ...; a two-key
// sequence is separated by a space ('C-x u').  An empty key disables
// the command.  Keys starting with 'C-x ' follow the XPrefix option.
//

const FiremacsDefaults = {
    options: {
        UseEscape: true,        // use ESC as 'M-'
        UseAlt: true,           // use Alt (Option) as 'M-'
        UseMeta: false,         // use Meta (Command) as 'M-'
        XPrefix: 'C-x',         // the prefix key
        AccessRegex: 'wiki',    // URL regex to disable access keys
        TurnoffRegex: '',       // URL regex to turn off Firemacs
        WalkForm: true,         // allow to walk through forms
        EditOnly: false         // edit area only
    },

    optionDescriptions: {
        UseEscape: "use ESC as 'M-'",
        UseAlt: "use Alt (Option on Mac) as 'M-'",
        UseMeta: "use Meta (Command on Mac) as 'M-'",
        XPrefix: 'is the prefix key',
        AccessRegex: 'URL regex to disable access keys',
        TurnoffRegex: 'URL regex to turn off Firemacs',
        WalkForm: 'allow to walk through forms',
        EditOnly: 'edit area only'
    },

    // [group, name, key, description]
    commands: [
        ['View', 'ScrollLineUp', 'C-p', 'scrolls a line up'],
        ['View', 'ScrollLineDown', 'C-n', 'scrolls a line down'],
        ['View', 'PreviousTab', 'C-b', 'moves to the previous tab'],
        ['View', 'NextTab', 'C-f', 'moves to the next tab'],
        ['View', 'ViScrollLineUp', 'k', 'scrolls a line up'],
        ['View', 'ViScrollLineDown', 'j', 'scrolls a line down'],
        ['View', 'ViScrollLeft', 'H', 'scrolls left'],
        ['View', 'ViScrollRight', 'L', 'scrolls right'],
        ['View', 'ViPreviousTab', 'h', 'moves to the previous tab'],
        ['View', 'ViNextTab', 'l', 'moves to the next tab'],
        ['View', 'ViScrollPageUp', 'b', 'scrolls a page up'],
        ['View', 'ViScrollPageDown', 'u', 'scrolls a page down'],
        ['View', 'PreviousPage', 'B', 'moves to the previous page'],
        ['View', 'NextPage', 'F', 'moves to the next page'],
        ['View', 'ReloadPage', 'R', 'reloads the page'],
        ['View', 'ViScrollTop', '<', 'scrolls to the top'],
        ['View', 'ViScrollBottom', '>', 'scrolls to the bottom'],
        ['View', 'ScrollTop', 'M-<', 'scrolls to the top'],
        ['View', 'ScrollBottom', 'M->', 'scrolls to the bottom'],

        ['Edit', 'PreviousLine', 'C-p', 'moves to the previous line/input'],
        ['Edit', 'NextLine', 'C-n', 'moves to the next line/input'],
        ['Edit', 'PreviousChar', 'C-b', 'moves to the previous char'],
        ['Edit', 'NextChar', 'C-f', 'moves to the next char'],
        ['Edit', 'ArrowPreviousLine', 'up', 'extends the region to the previous line'],
        ['Edit', 'ArrowNextLine', 'down', 'extends the region to the next line'],
        ['Edit', 'ArrowPreviousChar', 'left', 'extends the region to the previous char'],
        ['Edit', 'ArrowNextChar', 'right', 'extends the region to the next char'],
        ['Edit', 'BeggingOfLine', 'C-a', 'moves to the beg of the line'],
        ['Edit', 'EndOfLine', 'C-e', 'moves to the end of the line'],
        ['Edit', 'SetMark', 'C-SPC', 'puts the mark'],
        ['Edit', 'SetMarkAlias', 'C-i', 'puts the mark'],
        ['Edit', 'KillRegion', 'C-w', 'kills the region'],
        ['Edit', 'KillLineForward', 'C-k', 'kills the line forward'],
        ['Edit', 'KillLineBackward', 'C-u', 'kills the line backward'],
        ['Edit', 'Paste', 'C-y', 'pastes the copy buf'],
        ['Edit', 'DeleteCharForward', 'C-d', 'deletes the next char'],
        ['Edit', 'DeleteCharBackward', 'C-h', 'deletes the previous char'],
        ['Edit', 'Undo', 'C-x u', 'executes undo'],
        ['Edit', 'OpenLine', 'C-o', 'open one line'],
        ['Edit', 'NextWord', 'M-f', 'moves to the next word'],
        ['Edit', 'PreviousWord', 'M-b', 'moves to the previous word'],
        ['Edit', 'DeleteWordForward', 'M-d', 'deletes a word forward'],
        ['Edit', 'DeleteWordBackward', 'M-DEL', 'deletes a word backward'],
        ['Edit', 'MoveTop', 'M-<', 'moves to the top'],
        ['Edit', 'MoveBottom', 'M->', 'moves to the bottom'],

        ['Common', 'AllTabs', 'C-x b', 'switches tabs with filter'],
        ['Common', 'SearchForward', 'C-s', 'searches forward'],
        ['Common', 'SearchBackword', 'C-r', 'searches backward'],
        ['Common', 'ScrollPageUp', 'M-v', 'scrolls a page up'],
        ['Common', 'ScrollPageDown', 'C-v', 'scrolls a page down'],
        ['Common', 'ResetMark', 'C-g', 'resets the mark'],
        ['Common', 'FocusBody', 'C-x .', 'moves to the body'],
        ['Common', 'JumpInput', 'C-x t', 'moves to the first input'],
        ['Common', 'JumpSubmit', 'C-x s', 'moves to the first button'],
        // C-M-b was also bound to CopyTitleAndUrl, which won in the original.
        ['Common', 'CmPreviousTab', '', 'moves to the previous tab'],
        ['Common', 'CmNextTab', 'C-M-f', 'moves to the next tab'],
        ['Common', 'CloseTab', 'C-x k', 'closes the tab'],
        ['Common', 'Copy', 'M-w', 'copies the region'],
        ['Common', 'NextButton', 'M-n', 'moves to the next button'],
        ['Common', 'PreviousButton', 'M-p', 'moves to the previous button'],
        ['Common', 'KillAccessKeys', 'M-k', 'disables access keys'],
        ['Common', 'NewLine', 'C-m', 'acts as the return key'],
        ['Common', 'CopyUrl', 'C-M-u', 'copies the URL'],
        ['Common', 'CopyTitle', 'C-M-t', 'copies the title'],
        ['Common', 'CopyTitleAndUrl', 'C-M-b', 'copies the title and the URL'],
        ['Common', 'WebSearch', 'C-x C-e', 'searches the web for the selection'],
        ['Common', 'MapSearch', 'C-x C-a', 'searches a map for the selection'],
        ['Common', 'SavePage', 'C-x C-s', 'saves the page (HTML only)'],
        ['Common', 'SelectAll', 'C-x h', 'selects all']
        // Not available to extensions: JumpURLBar (C-x l), JumpSearchBar (C-x g),
        // OpenFile (C-x C-f), PreviousCompletion/NextCompletion (Menu).
    ],

    // Keys Firefox keeps for itself (reserved keys): pages and extensions
    // never see them.  Key by runtime.getPlatformInfo().os; the other Unix
    // systems are like Linux.  From key[reserved="true"] of Firefox 156.
    // On Mac they use Command, so Ctrl is free.
    reservedKeys: {
        win: {
            'C-n': 'new window', 'C-t': 'new tab', 'C-w': 'close tab',
            'C-W': 'close window', 'C-P': 'new private window', 'C-Q': 'quit'
        },
        linux: {
            'C-n': 'new window', 'C-t': 'new tab', 'C-w': 'close tab',
            'C-W': 'close window', 'C-P': 'new private window', 'C-q': 'quit'
        }
    },

    reservedKeysFor: (os) =>
        os === 'mac' || os === 'android' ? {}
            : FiremacsDefaults.reservedKeys[os] || FiremacsDefaults.reservedKeys.linux,

    // 'C-x u', 'M-<', 'C-M-f', 'j', 'SPC', 'up', ...
    isValidKey: (key) => {
        const token = /^(C-)?(M-)?([\x21-\x7e]|SPC|DEL|up|down|left|right)$/;
        const parts = key.split(' ');
        return parts.length <= 2 && parts.every(p => token.test(p));
    },

    // Settings in storage merged over the defaults.
    load: async () => {
        const stored = await browser.storage.local.get(['options', 'keys']);
        const options = Object.assign({}, FiremacsDefaults.options, stored.options);
        const keys = {};
        for (const [, name, key] of FiremacsDefaults.commands) {
            keys[name] = key;
        }
        Object.assign(keys, stored.keys);
        return {options, keys};
    }
};
