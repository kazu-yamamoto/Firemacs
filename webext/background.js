////////////////////////////////////////////////////////////////
//
// Toolbar button: toggles Firemacs on and off.
// The state is kept in storage.local and read by content scripts.
//

const showStatus = (enabled) => {
    browser.browserAction.setIcon({
        path: enabled
            ? {16: 'icon16.png', 32: 'icon32.png'}
            : {16: 'icon16gray.png', 32: 'icon32gray.png'}
    });
    browser.browserAction.setTitle({
        title: enabled ? 'Firemacs enabled' : 'Firemacs disabled'
    });
};

const isEnabled = async () => {
    const {enabled = true} = await browser.storage.local.get('enabled');
    return enabled;
};

browser.browserAction.onClicked.addListener(async () => {
    const enabled = !(await isEnabled());
    await browser.storage.local.set({enabled});
    showStatus(enabled);
});

// The background page is an event page, so it runs again on each wake-up.
isEnabled().then(showStatus);

////////////////////////////////////////////////////////////////
//
// Commands from content scripts that need the tabs API.
//

const moveTab = async (tab, dir) => {
    const tabs = (await browser.tabs.query({windowId: tab.windowId, hidden: false}))
        .sort((a, b) => a.index - b.index);
    const i = tabs.findIndex(t => t.id === tab.id);
    const next = tabs[(i + dir + tabs.length) % tabs.length];
    if (next.id !== tab.id) {
        await browser.tabs.update(next.id, {active: true});
    }
};

const TabCommands = {
    moveTab,
    goBack:    (tab) => browser.tabs.goBack(tab.id),
    goForward: (tab) => browser.tabs.goForward(tab.id),
    reload:    (tab) => browser.tabs.reload(tab.id)
};

browser.runtime.onMessage.addListener((msg, sender) => {
    const command = TabCommands[msg.command];
    if (command && sender.tab) {
        return command(sender.tab, msg.arg);
    }
});
