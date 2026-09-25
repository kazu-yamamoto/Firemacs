#!/usr/bin/env python3
"""Which Firemacs keys reach the page on this platform?

Firefox keeps some shortcuts (reserved keys such as Ctrl+N and Ctrl+W on
Windows/Linux) from web pages, and content scripts are treated like pages.
WebDriver key events may not take the same path, so keys are sent as real
OS input here, and Marionette is used only to set up and to observe.

For each key this reports whether the Firemacs command ran, and what
Firefox did by itself (new window, closed tab, sidebar, dialog, ...).

    Linux (X11):  python3 reserved_keys.py --inject xdotool
    Windows:      python reserved_keys.py --inject sendinput

The browser window must be visible and able to take the focus; on Windows
this must run in the desktop session (not in an SSH session).
"""

import argparse
import functools
import http.server
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # embeddable Python
import e2e  # noqa: E402

HERE = e2e.HERE

TEXT = 'foo bar\nbaz qux'

# (keys, caret, check): keys are typed in the textarea holding TEXT with
# the caret at the given offset; check(state) tells if Firemacs acted.
# state = [value, selectionStart, selectionEnd, activeElement id/tag]
EDIT = [
    (['C-f'], 4, lambda s: s[1] == 5),
    (['C-b'], 4, lambda s: s[1] == 3),
    (['C-n'], 4, lambda s: s[1] == 12),
    (['C-p'], 12, lambda s: s[1] == 4),
    (['C-a'], 5, lambda s: s[1:3] == [0, 0]),
    (['C-e'], 1, lambda s: s[1:3] == [7, 7]),
    (['C-d'], 4, lambda s: s[0] == 'foo ar\nbaz qux'),
    (['C-h'], 4, lambda s: s[0] == 'foobar\nbaz qux'),
    (['C-k'], 4, lambda s: s[0] == 'foo \nbaz qux'),
    (['C-u'], 4, lambda s: s[0] == 'bar\nbaz qux'),
    (['C-o'], 4, lambda s: s[0] == 'foo \nbar\nbaz qux' and s[1] == 4),
    (['C-k', 'C-y'], 4, lambda s: s[0] == TEXT),
    (['C-SPC', 'C-f'], 4, lambda s: s[1:3] == [4, 5]),
    (['C-i', 'C-f'], 4, lambda s: s[1:3] == [4, 5]),
    (['C-SPC', 'M-f', 'C-w'], 4, lambda s: s[0] == 'foo \nbaz qux'),
    (['C-SPC', 'C-f', 'C-g'], 4, lambda s: s[1:3] == [5, 5]),
    (['C-k', 'C-x', 'u'], 4, lambda s: s[0] == TEXT),
    (['C-x', 'h'], 4, lambda s: s[1:3] == [0, 15]),
    (['C-m'], 4, lambda s: s[0] == 'foo \nbar\nbaz qux'),
    (['M-f'], 4, lambda s: s[1] == 7),
    (['M-b'], 6, lambda s: s[1] == 4),
    (['M-d'], 4, lambda s: s[0] == 'foo \nbaz qux'),
    (['M-DEL'], 7, lambda s: s[0] == 'foo \nbaz qux'),
    (['M-<'], 5, lambda s: s[1] == 0),
    (['M->'], 1, lambda s: s[1] == 15),
    (['C-SPC', 'M-f', 'M-w', 'C-e', 'C-y'], 4, lambda s: s[0] == 'foo barbar\nbaz qux'),
    (['ESC', 'f'], 4, lambda s: s[1] == 7),
    (['C-[', 'f'], 4, lambda s: s[1] == 7),
    (['C-s'], 4, lambda s: s[3] == 'div'),      # the minibuffer
    (['C-r'], 4, lambda s: s[3] == 'div'),
    (['C-x', 'b'], 4, lambda s: s[3] == 'div'),
    (['M-n'], 4, lambda s: s[3] == 'b1'),
    (['M-p'], 4, lambda s: s[3] == 'b2'),
    (['C-x', 't'], 4, lambda s: s[3] == 'ta'),        # stays in a text field
    (['C-x', '.'], 4, lambda s: s[3] == 'body'),
    (['M-k'], 4, lambda s: s[4] == 0),
]

# Keys typed with no field focused on view.html; check(scrollY, maxY).
VIEW = [
    (['C-n'], 0, lambda y, m: y == 40),
    (['C-p'], 80, lambda y, m: y == 40),
    (['j'], 0, lambda y, m: y == 40),
    (['C-v'], 0, lambda y, m: y > 100),
    (['M-v'], 1000, lambda y, m: y < 1000),
    (['M->'], 0, lambda y, m: y == m),
    (['M-<'], 1000, lambda y, m: y == 0),
]

# Keys that switch or close tabs; typed on view.html in the first of two tabs.
TABS = [
    (['C-f'], lambda t: t['sel'] == 1 and t['tabs'] == 2),
    (['C-b'], lambda t: t['sel'] == 1 and t['tabs'] == 2),
    (['C-M-f'], lambda t: t['sel'] == 1 and t['tabs'] == 2),
    (['C-x', 'k'], lambda t: t['tabs'] == 1),
]

SNAPSHOT = """
const wins = [...Services.wm.getEnumerator(null)].length;
const box = gBrowser.getTabDialogBox ? gBrowser.getTabDialogBox(gBrowser.selectedBrowser) : null;
const count = (m) => (m && m._dialogs) ? m._dialogs.length : 0;
const dialogs = box ? count(box.getTabDialogManager()) + count(box.getContentDialogManager()) : 0;
const sidebar = window.SidebarController ? !!SidebarController.isOpen
              : !document.getElementById('sidebar-box').hidden;
const findbar = gBrowser.isFindBarInitialized() && !gBrowser.getCachedFindBar().hidden;
const popups = [...document.querySelectorAll('menupopup, panel')]
    .filter(p => p.state === 'open' || p.state === 'showing').map(p => p.id || p.localName);
const a = document.activeElement;
const urlbar = !!(a && a.closest && a.closest('#urlbar, #searchbar'));
return {wins, tabs: gBrowser.tabs.length, sel: gBrowser.tabs.indexOf(gBrowser.selectedTab),
        dialogs, sidebar, findbar, popups, urlbar, url: gBrowser.currentURI.spec};
"""

CLEANUP = """
for (const w of [...Services.wm.getEnumerator(null)]) {
    if (w !== window) w.close();
}
while (gBrowser.tabs.length > arguments[0]) gBrowser.removeTab(gBrowser.tabs[gBrowser.tabs.length - 1]);
if (window.SidebarController && SidebarController.isOpen) SidebarController.hide();
if (gBrowser.isFindBarInitialized()) gBrowser.getCachedFindBar().close(true);
for (const p of document.querySelectorAll('menupopup, panel')) {
    if (p.state === 'open' || p.state === 'showing') p.hidePopup();
}
const box = gBrowser.getTabDialogBox ? gBrowser.getTabDialogBox(gBrowser.selectedBrowser) : null;
if (box) box.abortAllDialogs();
gBrowser.selectedTab = gBrowser.tabs[0];
window.focus();
gBrowser.selectedBrowser.focus();
"""

STATE = """
const el = document.querySelector('#ta');
const a = document.activeElement;
return [el.value, el.selectionStart, el.selectionEnd,
        a.id || a.localName, document.querySelectorAll('[accesskey]').length];
"""


class Xdotool:
    """Real X input through XTEST."""

    NAMES = {'SPC': 'space', 'DEL': 'BackSpace', 'ESC': 'Escape', 'RET': 'Return',
             '<': 'less', '>': 'greater', '[': 'bracketleft', '.': 'period'}

    def __init__(self, display):
        self.env = dict(os.environ, DISPLAY=display)

    def run(self, *args):
        try:
            return subprocess.run(['xdotool', *args], env=self.env, capture_output=True,
                                  text=True, timeout=5)
        except subprocess.TimeoutExpired:
            return subprocess.CompletedProcess(args, 1, '', 'timeout')

    def focus(self):
        ids = self.run('search', '--onlyvisible', '--class', 'firefox').stdout.split()
        if ids:
            self.run('windowfocus', ids[-1])     # no --sync: there is no window manager

    def key(self, chord):
        parts = [chord] if chord in self.NAMES or len(chord) == 1 else chord.split('-')
        mods = {'C': 'ctrl', 'M': 'alt'}
        keysym = self.NAMES.get(parts[-1], parts[-1])
        self.run('key', '--clearmodifiers', '+'.join([mods[m] for m in parts[:-1]] + [keysym]))

    def dismiss_native_dialogs(self):
        """Close GTK file dialogs (Open File, Save As, ...) if any appeared."""
        found = False
        for name in ['Open File', 'Save As', 'File Upload', 'Print']:
            for wid in self.run('search', '--onlyvisible', '--name', name).stdout.split():
                self.run('windowfocus', wid)
                self.run('key', 'Escape')
                found = True
        return found


class SendInput:
    """Real Windows input with keybd_event(), from the desktop session."""

    def __init__(self, pid_of_firefox):
        import ctypes
        from ctypes import wintypes
        self.ctypes = ctypes
        self.user32 = ctypes.WinDLL('user32', use_last_error=True)
        self.wintypes = wintypes
        self.pid = pid_of_firefox
        self.EnumProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def windows(self, cls):
        """Visible top-level windows of class cls that belong to Firefox."""
        found = []
        user32, wt = self.user32, self.wintypes

        def proc(hwnd, _):
            name = self.ctypes.create_unicode_buffer(256)
            user32.GetClassNameW(hwnd, name, 256)
            pid = wt.DWORD()
            user32.GetWindowThreadProcessId(hwnd, self.ctypes.byref(pid))
            if name.value == cls and user32.IsWindowVisible(hwnd) and pid.value in self.pid():
                found.append(hwnd)
            return True
        user32.EnumWindows(self.EnumProc(proc), 0)
        return found

    def focus(self):
        wins = self.windows('MozillaWindowClass')
        if wins and self.user32.GetForegroundWindow() not in wins:
            # An Alt tap lets this process take the foreground.
            self.user32.keybd_event(0x12, 0, 0, 0)
            self.user32.keybd_event(0x12, 0, 2, 0)
            self.user32.SetForegroundWindow(wins[0])
            time.sleep(0.3)

    VK = {'SPC': 0x20, 'DEL': 0x08, 'ESC': 0x1B, 'RET': 0x0D}

    def key(self, chord):
        parts = [chord] if chord in self.VK or len(chord) == 1 else chord.split('-')
        mods = [{'C': 0x11, 'M': 0x12}[m] for m in parts[:-1]]
        name = parts[-1]
        if name in self.VK:
            vk, shift = self.VK[name], False
        else:
            code = self.user32.VkKeyScanW(ord(name))   # for the current layout
            vk, shift = code & 0xff, bool(code & 0x100)
        keys = mods + ([0x10] if shift else [])
        for k in keys:
            self.user32.keybd_event(k, 0, 0, 0)
        self.user32.keybd_event(vk, 0, 0, 0)
        self.user32.keybd_event(vk, 0, 2, 0)
        for k in reversed(keys):
            self.user32.keybd_event(k, 0, 2, 0)

    def dismiss_native_dialogs(self):
        """Close Windows dialogs (#32770: Open, Save As, ...) of Firefox."""
        found = self.windows('#32770')
        for hwnd in found:
            self.user32.PostMessageW(hwnd, 0x0010, 0, 0)      # WM_CLOSE
        return bool(found)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--firefox', default=e2e.FIREFOX)
    ap.add_argument('--inject', choices=['xdotool', 'sendinput'], required=True)
    ap.add_argument('--display', default=':99')
    ap.add_argument('--pref', action='append', default=[],
                    help='extra pref name=json, e.g. permissions.default.shortcuts=1')
    ap.add_argument('--json', default=None, help='write the results here')
    args = ap.parse_args()


    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    http_port = e2e.free_port()
    server = http.server.ThreadingHTTPServer(
        ('127.0.0.1', http_port), functools.partial(Quiet, directory=HERE))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = 'http://127.0.0.1:%d/' % http_port

    mn_port = e2e.free_port()
    profile = tempfile.mkdtemp(prefix='firemacs-keys-')
    # Ctrl+W on the last tab must not close the window (and quit Firefox).
    prefs = dict(e2e.PREFS, **{'marionette.port': mn_port,
                               'browser.tabs.closeWindowWithLastTab': False})
    for p in args.pref:
        name, value = p.split('=', 1)
        prefs[name] = json.loads(value)
    with open(os.path.join(profile, 'user.js'), 'w') as f:
        for k, v in prefs.items():
            f.write('user_pref(%s, %s);\n' % (json.dumps(k), json.dumps(v)))
    env = dict(os.environ, MOZ_ENABLE_WAYLAND='0')
    if args.inject == 'xdotool':
        env['DISPLAY'] = args.display
    firefox = subprocess.Popen([args.firefox, '-marionette', '-remote-allow-system-access',
                                '-no-remote', '-profile', profile],
                               env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def firefox_pids():
        """Firefox and its child processes (Windows)."""
        out = subprocess.run(['powershell', '-NoProfile', '-Command',
                              'Get-CimInstance Win32_Process -Filter "Name=\'firefox.exe\'"'
                              ' | % ProcessId'], capture_output=True, text=True).stdout
        return {int(x) for x in out.split()} or {firefox.pid}

    if args.inject == 'xdotool':
        inject = Xdotool(args.display)
    else:
        pids = {}

        def cached_pids():
            if not pids.get('v'):
                pids['v'] = firefox_pids()
            return pids['v']
        inject = SendInput(cached_pids)
    results = []
    try:
        mn = e2e.Marionette(mn_port)
        mn.call('WebDriver:NewSession', {'capabilities': {}})
        mn.call('Addon:Install', {'path': e2e.EXT, 'temporary': True})

        def chrome(script, *a):
            mn.call('Marionette:SetContext', {'value': 'chrome'})
            try:
                return mn.js(script, *a)
            finally:
                mn.call('Marionette:SetContext', {'value': 'content'})

        # When a key closed the tab Marionette was using, go on in another one.
        closed = {'tab': False}

        def safe(fn):
            try:
                return fn()
            except RuntimeError as e:
                if 'no such window' not in str(e):
                    raise
                closed['tab'] = True
                handles = mn.call('WebDriver:GetWindowHandles')
                mn.call('WebDriver:SwitchToWindow', {'handle': handles[0]})
                return fn()

        def goto(page):
            mn.call('WebDriver:Navigate', {'url': base + page})
            time.sleep(0.4)

        def press(keys):
            handle = mn.call('WebDriver:GetWindowHandle')
            inject.focus()
            for k in keys:
                inject.key(k)
                time.sleep(0.15)
            time.sleep(0.4)
            # A key may have closed the tab Marionette was using (Ctrl+W).
            handles = mn.call('WebDriver:GetWindowHandles')
            if handle not in handles:
                closed['tab'] = True
                mn.call('WebDriver:SwitchToWindow', {'handle': handles[0]})

        def side_effects(before, after, allowed=()):
            found = []
            for k in ['wins', 'tabs', 'sel', 'dialogs', 'sidebar', 'findbar', 'urlbar', 'url']:
                if k not in allowed and before[k] != after[k]:
                    found.append('%s: %s -> %s' % (k, before[k], after[k]))
            if after['popups']:
                found.append('popups: ' + ', '.join(after['popups']))
            return found

        def record(context, keys, handled, effects):
            results.append({'context': context, 'keys': ' '.join(keys),
                            'firemacs': handled, 'firefox': effects})
            print('%-6s %-22s firemacs=%-5s firefox=%s' % (
                context, ' '.join(keys), handled, '; '.join(effects) or '-'), flush=True)

        def reset(tabs=1):
            if inject.dismiss_native_dialogs():
                time.sleep(0.5)
            safe(lambda: chrome(CLEANUP, tabs))
            closed['tab'] = False

        goto('index.html')
        time.sleep(1)
        for keys, caret, check in EDIT:
            reset()
            goto('index.html')
            mn.js("""
                const el = document.querySelector('#ta');
                el.focus(); el.value = arguments[0]; el.setSelectionRange(arguments[1], arguments[1]);
            """, TEXT, caret)
            before = chrome(SNAPSHOT)
            press(keys)
            native = inject.dismiss_native_dialogs()
            after = safe(lambda: chrome(SNAPSHOT))
            state = None
            try:
                state = mn.js(STATE)
                handled = bool(check(state))
            except RuntimeError:
                handled = False
            effects = side_effects(before, after)
            if native:
                effects.append('native dialog')
            if closed['tab']:
                effects.append('tab closed')
            record('edit', keys, handled, effects)
            if state and state[3] == 'div':
                press(['C-g'])            # close the minibuffer

        for keys, start, check in VIEW:
            reset()
            goto('view.html')
            mn.js('document.activeElement.blur(); scrollTo(0, arguments[0]);', start)
            before = chrome(SNAPSHOT)
            press(keys)
            native = inject.dismiss_native_dialogs()
            after = safe(lambda: chrome(SNAPSHOT))
            try:
                y, maxy = mn.js('return [scrollY, scrollMaxY];')
            except RuntimeError:
                y, maxy = None, None
            effects = side_effects(before, after)
            if native:
                effects.append('native dialog')
            if closed['tab']:
                effects.append('tab closed')
            record('view', keys, y is not None and bool(check(y, maxy)), effects)

        for keys, check in TABS:
            reset()
            goto('view.html')
            chrome("gBrowser.addTrustedTab(arguments[0]); gBrowser.selectedTab = gBrowser.tabs[0];",
                   base + 'index.html')
            time.sleep(0.5)
            mn.js('document.activeElement.blur();')
            before = chrome(SNAPSHOT)
            press(keys)
            after = safe(lambda: chrome(SNAPSHOT))    # C-x k closes Marionette's tab
            effects = side_effects(before, after, allowed=('tabs', 'sel', 'url'))
            record('tabs', keys, bool(check(after)), effects)
            reset()
    finally:
        firefox.terminate()
        try:
            firefox.wait(10)
        except subprocess.TimeoutExpired:
            firefox.kill()
        server.shutdown()
        shutil.rmtree(profile, ignore_errors=True)
        if args.json:
            with open(args.json, 'w') as f:
                json.dump(results, f, indent=1)

    bad = [r for r in results if not r['firemacs'] or r['firefox']]
    print('\n%d keys, %d not working' % (len(results), len(bad)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
