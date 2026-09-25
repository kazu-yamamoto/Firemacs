#!/usr/bin/env python3
"""End-to-end test of the Firemacs prototype.

Starts a headless Firefox with Marionette (its built-in remote protocol),
installs the extension as a temporary add-on, and sends real key events
through WebDriver actions.  Only the Python standard library is used.

    python3 webext/test/e2e.py [--firefox PATH] [--headed]
"""

import argparse
import functools
import http.server
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
EXT = os.path.dirname(HERE)
FIREFOX = '/Applications/Firefox.app/Contents/MacOS/firefox'

KEYS = {'C': '', 'M': '',
        'ESC': '', 'DEL': '', 'SPC': ' ',
        'up': '', 'down': '', 'left': '', 'right': ''}

PREFS = {
    'marionette.port': 0,          # replaced below
    'dom.events.testing.asyncClipboard': True,
    'browser.shell.checkDefaultBrowser': False,
    'browser.startup.homepage_override.mstone': 'ignore',
    'browser.aboutwelcome.enabled': False,
    'datareporting.policy.dataSubmissionEnabled': False,
    'toolkit.telemetry.reportingpolicy.firstRun': False,
    'app.update.disabledForTesting': True,
}

def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


class Marionette:
    """Minimal Marionette client: messages are 'length:json'."""

    def __init__(self, port):
        for _ in range(300):
            try:
                self.sock = socket.create_connection(('127.0.0.1', port), 1)
                break
            except OSError:
                time.sleep(0.1)
        else:
            raise RuntimeError('cannot connect to Marionette')
        self.sock.settimeout(30)
        self.buf = b''
        self.msgid = 0
        self._read()                       # server hello

    def _read(self):
        while b':' not in self.buf:
            self.buf += self.sock.recv(65536)
        n, rest = self.buf.split(b':', 1)
        n = int(n)
        while len(rest) < n:
            rest += self.sock.recv(65536)
        self.buf = rest[n:]
        return json.loads(rest[:n])

    def call(self, command, params=None):
        self.msgid += 1
        data = json.dumps([0, self.msgid, command, params or {}]).encode()
        self.sock.sendall(b'%d:%s' % (len(data), data))
        while True:
            _, msgid, error, result = self._read()
            if msgid == self.msgid:
                break
        if error:
            raise RuntimeError('%s: %s' % (command, error))
        return result.get('value', result) if isinstance(result, dict) else result

    def js(self, script, *args):
        return self.call('WebDriver:ExecuteScript', {'script': script, 'args': list(args)})

    def keys(self, *chords):
        """Send chords such as 'C-f', 'M-<', 'C-x', 'u', 'ESC', 'M-DEL'."""
        actions = []
        for chord in chords:
            parts = [chord] if chord in KEYS else chord.split('-')
            mods, key = parts[:-1], parts[-1]
            key = KEYS.get(key, key)
            for m in mods:
                actions.append({'type': 'keyDown', 'value': KEYS[m]})
            actions.append({'type': 'keyDown', 'value': key})
            actions.append({'type': 'keyUp', 'value': key})
            for m in reversed(mods):
                actions.append({'type': 'keyUp', 'value': KEYS[m]})
        self.call('WebDriver:PerformActions', {'actions': [
            {'type': 'key', 'id': 'kbd', 'actions': actions}]})
        self.call('WebDriver:ReleaseActions')
        time.sleep(0.05)


SET_TEXT = """
const [sel, value, start, end] = arguments;
const el = document.querySelector(sel);
el.focus();
el.value = value;
el.setSelectionRange(start, end === null ? start : end);
"""

GET_TEXT = """
const el = document.querySelector(arguments[0]);
return [el.value, el.selectionStart, el.selectionEnd,
        document.activeElement.id];
"""

SET_CE = """
const [sel, text, offset] = arguments;
const el = document.querySelector(sel);
el.focus();
el.textContent = text;
const r = document.createRange();
r.setStart(el.firstChild, offset);
getSelection().removeAllRanges();
getSelection().addRange(r);
"""

GET_CE = """
const el = document.querySelector(arguments[0]);
const s = getSelection();
const r = document.createRange();
r.setStart(el, 0);
r.setEnd(s.focusNode, s.focusOffset);
return [el.innerText.replace(/\\n$/, ''), r.toString().length, s.toString()];
"""


BUTTON_ID = 'firemacs-prototype_mew_org-BAP'   # the button inside the toolbar item
BUTTON = "const b = document.getElementById('%s');" % BUTTON_ID


class Tests:
    def __init__(self, wd, base):
        self.wd = wd
        self.base = base
        self.failed = 0
        self.passed = 0

    def check(self, name, got, want):
        if got == want:
            self.passed += 1
            print('ok   %s' % name)
        else:
            self.failed += 1
            print('FAIL %s\n     got  %r\n     want %r' % (name, got, want))

    def text(self, value, start, *keys, sel='#ta', end=None):
        self.wd.js(SET_TEXT, sel, value, start, end)
        self.wd.keys(*keys)
        return self.wd.js(GET_TEXT, sel)

    def ce(self, text, offset, *keys):
        self.wd.js(SET_CE, '#ce', text, offset)
        self.wd.keys(*keys)
        return self.wd.js(GET_CE, '#ce')

    def run(self):
        t, c = self.text, self.check
        H = 'hello\nworld'

        c('C-f', t(H, 0, 'C-f')[:3], [H, 1, 1])
        c('C-b', t(H, 3, 'C-b')[:3], [H, 2, 2])
        c('C-e', t(H, 1, 'C-e')[:3], [H, 5, 5])
        c('C-a', t(H, 8, 'C-a')[:3], [H, 6, 6])
        c('C-n keeps column', t(H, 2, 'C-n')[:3], [H, 8, 8])
        c('C-p keeps column', t(H, 9, 'C-p')[:3], [H, 3, 3])
        c('goal column', t('abcdef\nab\nabcdef', 5, 'C-n', 'C-n')[:3],
          ['abcdef\nab\nabcdef', 15, 15])
        c('C-f over surrogate pair', t('a\U0001F600b', 1, 'C-f')[:3],
          ['a\U0001F600b', 3, 3])
        c('M-f', t('foo bar baz', 0, 'M-f', 'M-f')[:3], ['foo bar baz', 7, 7])
        c('M-b', t('foo bar baz', 11, 'M-b')[:3], ['foo bar baz', 8, 8])
        c('ESC f', t('foo bar', 0, 'ESC', 'f')[:3], ['foo bar', 3, 3])
        c('C-[ f', t('foo bar', 0, 'C-[', 'f')[:3], ['foo bar', 3, 3])
        c('M-> / M-<', t(H, 3, 'M->')[:3], [H, 11, 11])
        c('M-<', t(H, 3, 'M-<')[:3], [H, 0, 0])

        c('C-d', t('abc', 1, 'C-d')[:3], ['ac', 1, 1])
        c('C-h', t('abc', 1, 'C-h')[:3], ['bc', 0, 0])
        c('M-d', t('foo bar', 0, 'M-d')[:3], [' bar', 0, 0])
        c('M-DEL', t('foo bar', 7, 'M-DEL')[:3], ['foo ', 4, 4])
        c('C-o', t('ab', 1, 'C-o')[:3], ['a\nb', 1, 1])

        c('C-k', t('foo bar\nbaz', 3, 'C-k')[:3], ['foo\nbaz', 3, 3])
        c('C-k C-k C-y (appended kill)',
          t('foo bar\nbaz', 3, 'C-k', 'C-k', 'C-e', 'C-y')[:3],
          ['foobaz bar\n', 11, 11])
        c('C-u', t('foo bar', 4, 'C-u', 'C-e', 'C-y')[:3], ['barfoo ', 7, 7])
        c('C-x u', t('foo bar', 3, 'C-k', 'C-x', 'u')[0], 'foo bar')

        c('C-SPC M-f selects', t('hello world', 0, 'C-SPC', 'M-f')[:3],
          ['hello world', 0, 5])
        c('C-SPC backward', t('hello world', 11, 'C-SPC', 'M-b')[:3],
          ['hello world', 6, 11])
        c('C-SPC C-n', t(H, 1, 'C-SPC', 'C-n')[:3], [H, 1, 7])
        c('C-SPC arrow extends', t(H, 0, 'C-SPC', 'right', 'right')[:3], [H, 0, 2])
        c('C-w C-y', t('hello world', 0, 'C-SPC', 'M-f', 'C-w', 'C-e', 'C-y')[:3],
          [' worldhello', 11, 11])
        c('M-w C-y', t('hello world', 0, 'C-SPC', 'M-f', 'M-w', 'C-e', 'C-y')[:3],
          ['hello worldhello', 16, 16])
        c('C-g', t('hello world', 0, 'C-SPC', 'M-f', 'C-g', 'C-f')[:3],
          ['hello world', 6, 6])
        c('C-x h', t(H, 3, 'C-x', 'h')[:3], [H, 0, 11])

        c('typing drops the mark', t('abc', 0, 'C-SPC', 'x', 'C-f')[:3],
          ['xabc', 2, 2])
        # The caret is moved by the page between the two C-n.
        self.text('abcdef\nab\nabcdef', 5, 'C-n')
        c('goal column reset by other moves',
          t('abcdef\nab\nabcdef', 1, 'C-n')[:3], ['abcdef\nab\nabcdef', 8, 8])
        self.text('foo bar\nbaz', 3, 'C-k')
        c('C-k does not append after other moves',
          t('one two', 3, 'C-k', 'C-a', 'C-y')[0], ' twoone')
        c('plain typing untouched', t('ab', 1, 'x', 'Y')[:3], ['axYb', 3, 3])
        c('arrow without mark is native', t(H, 0, 'right')[:3], [H, 1, 1])

        c('walk form: C-n at end of input',
          t('first input', 11, 'C-n', sel='#in1')[3], 'in2')
        c('walk form: C-n moves to end first',
          t('first input', 2, 'C-n', sel='#in1')[1:], [11, 11, 'in1'])

        # Visual lines in a wrapped textarea: C-n moves by logical line.
        c('narrow textarea C-n (logical line)',
          t('a long line that wraps several times', 0, 'C-n', sel='#narrow')[:3],
          ['a long line that wraps several times', 36, 36])

        # contenteditable
        e = self.ce
        c('ce C-e', e('hello\nworld', 1, 'C-e')[:2], ['hello\nworld', 5])
        c('ce C-n', e('hello\nworld', 2, 'C-n')[:2], ['hello\nworld', 8])
        c('ce M-f', e('foo bar baz', 0, 'M-f')[:2], ['foo bar baz', 3])
        c('ce C-k', e('foo bar\nbaz', 3, 'C-k')[:2], ['foo\nbaz', 3])
        c('ce C-d', e('abc', 1, 'C-d')[:2], ['ac', 1])
        c('ce C-SPC C-f C-f', e('abc', 0, 'C-SPC', 'C-f', 'C-f')[2], 'ab')
        c('ce C-w C-y', e('hello world', 0, 'C-SPC', 'M-f', 'C-w', 'C-e', 'C-y')[:2],
          [' worldhello', 11])

        # Keys consumed by Firemacs must not reach page handlers.
        self.wd.js('window.pageKeys = 0;')
        self.text(H, 0, 'C-f', 'C-e')
        c('consumed keys hidden from page', self.wd.js('return window.pageKeys;'), 0)

        # Toolbar button toggles Firemacs off and on.
        c('button: disabled', self.click_button(), ['Firemacs disabled', True])
        self.wd.js('window.pageKeys = 0;')
        self.text(H, 0, 'C-f', 'C-e')
        c('disabled: keys reach page', self.wd.js('return window.pageKeys;'), 2)
        c('button: enabled', self.click_button(), ['Firemacs enabled', False])
        c('enabled again: C-e', t(H, 1, 'C-e')[:3], [H, 5, 5])

    def goto(self, page):
        self.wd.call('WebDriver:Navigate', {'url': self.base + page})
        time.sleep(0.5)

    def chrome_js(self, script):
        self.wd.call('Marionette:SetContext', {'value': 'chrome'})
        try:
            return self.wd.js(script)
        finally:
            self.wd.call('Marionette:SetContext', {'value': 'content'})

    def click(self, selector):
        el = self.wd.call('WebDriver:FindElement', {'using': 'css selector', 'value': selector})
        self.wd.call('WebDriver:ElementClick', {'id': list(el.values())[0]})

    def run_view(self):
        wd, c = self.wd, self.check
        pos = lambda: wd.js('return [scrollX, scrollY];')
        reset = lambda: wd.js('document.activeElement.blur(); scrollTo(0, 0);')

        self.goto('view.html')
        page = wd.js('return innerHeight;') - 80
        bottom = wd.js('return scrollMaxY;')
        reset(); wd.keys('j', 'j'); c('view j', pos(), [0, 80])
        wd.keys('k'); c('view k', pos(), [0, 40])
        reset(); wd.keys('C-n'); c('view C-n', pos(), [0, 40])
        wd.keys('C-p'); c('view C-p', pos(), [0, 0])
        reset(); wd.keys('L', 'L'); c('view L', pos(), [80, 0])
        wd.keys('H'); c('view H', pos(), [40, 0])
        reset(); wd.keys('u'); c('view u', pos(), [0, page])
        wd.keys('b'); c('view b', pos(), [0, 0])
        reset(); wd.keys('C-v', 'C-v', 'M-v'); c('view C-v C-v M-v', pos(), [0, page])
        reset(); wd.keys('>'); c('view >', pos(), [0, bottom])
        wd.keys('<'); c('view <', pos(), [0, 0])
        reset(); wd.keys('M->'); c('view M->', pos(), [0, bottom])
        wd.keys('ESC', '<'); c('view ESC <', pos(), [0, 0])

        reset()
        wd.js("document.querySelector('#mail').focus();")
        wd.keys('j', 'k', 'l')
        c('view keys typed into email field',
          [wd.js("return document.querySelector('#mail').value;"), pos()], ['jkl', [0, 0]])

        # A page whose document does not scroll.
        self.goto('app.html')
        top = lambda: wd.js("return ['#side', '#main'].map(s => document.querySelector(s).scrollTop);")
        wd.js('document.activeElement.blur();')
        wd.keys('j'); c('app: j scrolls the largest scroller', top(), [0, 40])
        self.click('#side')
        wd.keys('j', 'j'); c('app: j scrolls the clicked scroller', top(), [80, 40])

        # Tabs
        self.goto('view.html')
        first = wd.call('WebDriver:GetWindowHandle')
        second = wd.call('WebDriver:NewWindow', {'type': 'tab'})['handle']
        selected = lambda: self.chrome_js('return gBrowser.tabs.indexOf(gBrowser.selectedTab);')
        for handle, key, want in [(second, 'l', 0), (first, 'h', 1),
                                  (second, 'C-f', 0), (first, 'C-b', 1)]:
            wd.call('WebDriver:SwitchToWindow', {'handle': handle})
            if handle == second and wd.js('return location.href;') == 'about:blank':
                self.goto('view.html')
            wd.js('document.activeElement.blur();')
            wd.keys(key)
            time.sleep(0.3)
            c('tab %s from %d' % (key, 1 - want), selected(), want)
        wd.call('WebDriver:SwitchToWindow', {'handle': second})
        wd.call('WebDriver:CloseWindow')
        wd.call('WebDriver:SwitchToWindow', {'handle': first})

        # History
        self.goto('index.html')
        self.goto('view.html')
        wd.js('document.activeElement.blur();')
        wd.keys('B'); time.sleep(1)
        c('B goes back', wd.js('return location.pathname;'), '/index.html')
        wd.js('document.activeElement.blur();')
        wd.keys('F'); time.sleep(1)
        c('F goes forward', wd.js('return location.pathname;'), '/view.html')
        wd.js('window.marker = 1; document.activeElement.blur();')
        wd.keys('R'); time.sleep(1)
        c('R reloads', wd.js('return typeof window.marker;'), 'undefined')

    def click_button(self):
        """Click the toolbar button and return [tooltip, gray icon?]."""
        wd = self.wd
        wd.call('Marionette:SetContext', {'value': 'chrome'})
        try:
            el = wd.call('WebDriver:FindElement', {
                'using': 'css selector', 'value': '#' + BUTTON_ID})
            wd.call('WebDriver:ElementClick', {'id': list(el.values())[0]})
            time.sleep(0.3)
            return wd.js(BUTTON + 'return [b.getAttribute("tooltiptext"),'
                                  ' b.style.cssText.includes("gray.png")];')
        finally:
            wd.call('Marionette:SetContext', {'value': 'content'})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--firefox', default=FIREFOX)
    ap.add_argument('--headed', action='store_true')
    args = ap.parse_args()

    http_port = free_port()
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass
    handler = functools.partial(Quiet, directory=HERE)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', http_port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    mn_port = free_port()
    profile = tempfile.mkdtemp(prefix='firemacs-test-')
    prefs = dict(PREFS, **{'marionette.port': mn_port})
    with open(os.path.join(profile, 'user.js'), 'w') as f:
        for k, v in prefs.items():
            f.write('user_pref(%s, %s);\n' % (json.dumps(k), json.dumps(v)))
    cmd = [args.firefox, '-marionette', '-remote-allow-system-access',
           '-no-remote', '-profile', profile]
    if not args.headed:
        cmd.append('-headless')
    firefox = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        mn = Marionette(mn_port)
        mn.call('WebDriver:NewSession', {'capabilities': {}})
        mn.call('Addon:Install', {'path': EXT, 'temporary': True})
        mn.call('WebDriver:Navigate', {'url': 'http://127.0.0.1:%d/index.html' % http_port})
        time.sleep(0.5)
        tests = Tests(mn, 'http://127.0.0.1:%d/' % http_port)
        tests.run()
        tests.run_view()
        print('\n%d passed, %d failed' % (tests.passed, tests.failed))
        return 1 if tests.failed else 0
    finally:
        firefox.terminate()
        firefox.wait()
        server.shutdown()
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
