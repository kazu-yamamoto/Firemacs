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
