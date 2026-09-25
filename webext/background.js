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

// Saves the HTML only ("Web Page, complete" is not available to extensions).
const savePage = (tab) => {
    const name = (tab.title || 'page').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
          .trim().slice(0, 100);
    return browser.downloads.download({url: tab.url, filename: name + '.html', saveAs: true});
};

const TabCommands = {
    moveTab,
    goBack:    (tab) => browser.tabs.goBack(tab.id),
    goForward: (tab) => browser.tabs.goForward(tab.id),
    reload:    (tab) => browser.tabs.reload(tab.id),
    closeTab:  (tab) => browser.tabs.remove(tab.id),
    tabInfo:   (tab) => Promise.resolve({title: tab.title, url: tab.url}),
    webSearch: (tab, query) => browser.search.search({query, disposition: 'NEW_TAB'}),
    mapSearch: (tab, query) => browser.tabs.create({
        url: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query),
        index: tab.index + 1,
        openerTabId: tab.id
    }),
    savePage,
    // Most recently used first; the current tab last.
    listTabs: async (tab) => {
        const tabs = await browser.tabs.query({windowId: tab.windowId, hidden: false});
        return tabs
            .sort((a, b) => (a.id === tab.id) - (b.id === tab.id) ||
                            b.lastAccessed - a.lastAccessed)
            .map(t => ({id: t.id, title: t.title, url: t.url}));
    },
    activateTab: (tab, id) => browser.tabs.update(id, {active: true})
};

browser.runtime.onMessage.addListener((msg, sender) => {
    const command = TabCommands[msg.command];
    if (command && sender.tab) {
        return command(sender.tab, msg.arg);
    }
});
