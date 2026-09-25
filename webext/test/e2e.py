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
import re
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

KEYS = {'C': '\ue009', 'M': '\ue00a', 'Cmd': '\ue03d', 'RET': '\ue006',
        'ESC': '\ue00c', 'DEL': '\ue003', 'SPC': ' ',
        'up': '\ue013', 'down': '\ue015', 'left': '\ue012', 'right': '\ue014'}

PREFS = {
    'marionette.port': 0,          # replaced below
    'dom.events.testing.asyncClipboard': True,
    'browser.shell.checkDefaultBrowser': False,
    'browser.startup.homepage_override.mstone': 'ignore',
    'browser.aboutwelcome.enabled': False,
    'datareporting.policy.dataSubmissionEnabled': False,
    'toolkit.telemetry.reportingpolicy.firstRun': False,
    'app.update.disabledForTesting': True,
    # No traffic to the outside (web/map search tabs); localhost is never proxied.
    'network.proxy.type': 1,
    'network.proxy.http': '127.0.0.1',
    'network.proxy.http_port': 9,
    'network.proxy.ssl': '127.0.0.1',
    'network.proxy.ssl_port': 9,
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
            parts = [chord] if chord in KEYS or len(chord) == 1 else chord.split('-')
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
        try:
            self.call('WebDriver:ReleaseActions')
        except RuntimeError as e:
            if 'no such window' not in str(e):   # the keys closed the tab
                raise
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


with open(os.path.join(EXT, 'manifest.json')) as _f:
    ADDON_ID = json.load(_f)['browser_specific_settings']['gecko']['id']
# The button inside the toolbar item; Firefox's makeWidgetId() of the ID.
BUTTON_ID = re.sub(r'[^a-z0-9_-]', '_', ADDON_ID.lower()) + '-BAP'
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

        # Visual lines in a wrapped textarea: C-n/C-p must agree with the
        # native down/up keys (arrows are native while the mark is not set).
        # Firefox keeps its desired x across setSelectionRange(), so left
        # and right are pressed first to make it take the caret position.
        texts = [
            'a long line that wraps several times in a narrow textarea',
            'short\n\nline two is longer than the width\nend',
            'abcdefghijklmnopqrstuvwxyz0123456789 word',
            '日本語の文章は文字ごとに折り返されます。句読点も。',
            'emoji \U0001F600\U0001F600 wrap \U0001F600 test of pairs',
        ]
        for text in texts:
            units = text.encode('utf-16-le')     # offsets are UTF-16 in JS
            n = len(units) // 2
            unit = lambda i: int.from_bytes(units[2 * i:2 * i + 2], 'little')
            # Offsets where a visual line starts after a wrap (not after a newline).
            wraps = set(self.visual_line_starts('#narrow', text)) - {0} - {
                i + 1 for i in range(n) if unit(i) == 0x0a}
            diffs = []
            for p in range(1, n):
                if 0xdc00 <= unit(p) <= 0xdfff:
                    continue                # inside a surrogate pair
                for ours, native in [('C-n', 'down'), ('C-p', 'up')]:
                    q_ours = t(text, p, ours, sel='#narrow')[1]
                    q_native = t(text, p, 'left', 'right', native, sel='#narrow')[1]
                    # The native caret can stay at the end of a wrapped line (a
                    # wrap offset shown on the upper line); setSelectionRange()
                    # cannot, so C-n/C-p stop just before it, as Emacs does.
                    if q_native in wraps and q_ours == q_native - 1:
                        continue
                    if q_ours != q_native:
                        diffs.append((p, ours, q_ours, q_native))
            c('C-n/C-p match down/up: %r' % text[:20], diffs, [])
        text = texts[1]
        for p in [2, 5, 20]:
            c('C-n C-n C-n match down x3 from %d' % p,
              t(text, p, 'C-n', 'C-n', 'C-n', sel='#narrow')[1],
              t(text, p, 'left', 'right', 'down', 'down', 'down', sel='#narrow')[1])
            c('C-p C-p match up x2 from %d' % (p + 30),
              t(text, p + 30, 'C-p', 'C-p', sel='#narrow')[1],
              t(text, p + 30, 'left', 'right', 'up', 'up', sel='#narrow')[1])

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

    def run_common(self):
        wd, c = self.wd, self.check
        active = lambda: wd.js('return document.activeElement.id || document.activeElement.localName;')
        blur = lambda: wd.js('document.activeElement.blur();')
        self.goto('index.html')

        blur(); wd.keys('C-x', 't'); c('C-x t', active(), 'in1')
        wd.js("document.querySelector('#ta').focus();")
        wd.keys('C-x', '.'); c('C-x .', active(), 'body')
        blur(); wd.keys('M-n'); c('M-n', active(), 'b1')
        wd.keys('M-n'); c('M-n M-n', active(), 'b2')
        wd.keys('M-p'); c('M-p', active(), 'b1')
        blur(); wd.keys('C-x', 's'); c('C-x s', active(), 'b1')
        blur(); wd.keys('M-k')
        c('M-k', wd.js("return document.querySelectorAll('[accesskey]').length;"), 0)

        c('C-m in textarea', self.text('abcd', 2, 'C-m')[:3], ['ab\ncd', 3, 3])
        self.text('', 0, 'C-m', sel='#q')
        c('C-m submits a form', wd.js('return window.submitted;'), 1)
        self.text('', 0, 'C-m', sel='#chat')
        c('C-m reaches Enter handlers',
          wd.js('return [window.chatEnter, window.submitted];'), [1, 1])

        blur(); wd.keys('C-x', 'h')
        c('C-x h outside fields', wd.js('return getSelection().toString().length > 100;'), True)
        wd.keys('C-g'); c('C-g outside fields', wd.js('return getSelection().isCollapsed;'), True)
        self.select_text('#log', 'selected words')
        wd.keys('M-w')
        c('M-w outside fields', self.text('', 0, 'C-y')[0], 'selected words')

        url, title = wd.js('return [location.href, document.title];')
        blur(); wd.keys('C-M-u'); time.sleep(0.3)
        c('C-M-u', self.text('', 0, 'C-y')[0], url)
        blur(); wd.keys('C-M-t'); time.sleep(0.3)
        c('C-M-t', self.text('', 0, 'C-y')[0], title)
        blur(); wd.keys('C-M-b'); time.sleep(0.3)
        c('C-M-b', self.text('', 0, 'C-y')[0], title + '\n' + url)

        # Tabs opened by searches; their URLs are checked, not their contents.
        uris = lambda: self.chrome_js(
            'return gBrowser.tabs.map(t => t.linkedBrowser.currentURI.spec);')
        self.select_text('#log', 'firemacs')
        wd.keys('C-x', 'C-e'); time.sleep(1.5)
        tabs = uris()
        c('C-x C-e opens a search tab',
          [len(tabs), 'firemacs' in tabs[-1]], [2, True])
        self.chrome_js('gBrowser.removeTab(gBrowser.tabs[1]);')
        self.select_text('#log', 'Tokyo Station')
        wd.keys('C-x', 'C-a'); time.sleep(1.5)
        tabs = uris()
        c('C-x C-a opens a map tab',
          [len(tabs), tabs[-1].startswith('https://www.google.com/maps/search/')
                      and 'Tokyo%20Station' in tabs[-1]], [2, True])
        self.chrome_js('gBrowser.removeTab(gBrowser.tabs[1]);')
        wd.js('getSelection().removeAllRanges();')
        blur(); wd.keys('C-x', 'C-e'); time.sleep(0.5)
        c('C-x C-e without selection', len(uris()), 1)

        # C-M-f and C-x k
        first = wd.call('WebDriver:GetWindowHandle')
        second = wd.call('WebDriver:NewWindow', {'type': 'tab'})['handle']
        wd.call('WebDriver:SwitchToWindow', {'handle': second})
        self.goto('view.html')
        selected = lambda: self.chrome_js('return gBrowser.tabs.indexOf(gBrowser.selectedTab);')
        blur(); wd.keys('C-M-f'); time.sleep(0.3)
        c('C-M-f', selected(), 0)
        wd.call('WebDriver:SwitchToWindow', {'handle': second})
        blur(); wd.keys('C-x', 'k'); time.sleep(0.5)
        c('C-x k', len(uris()), 1)
        wd.call('WebDriver:SwitchToWindow', {'handle': first})

    def run_minibuffer(self):
        wd, c = self.wd, self.check
        # The current match: the highlight while searching, the selection after.
        found = lambda: wd.js("""
            const h = CSS.highlights.get('firemacs-current');
            const s = getSelection();
            const r = (h && h.size) ? [...h][0] : (s.isCollapsed ? null : s.getRangeAt(0));
            if (!r) return null;
            const n = r.startContainer;
            return [r.toString(), (n.nodeType === 1 ? n : n.parentElement).closest('[id]').id];
        """)
        # The minibuffer is the only <div> that can get the focus.
        opened = lambda: wd.js("return document.activeElement.localName === 'div';")
        start = lambda: wd.js("""
            document.activeElement.blur();
            getSelection().removeAllRanges();
            scrollTo(0, 0);
        """)

        self.goto('search.html')
        start(); wd.keys('C-s')
        c('C-s opens the minibuffer', opened(), True)
        wd.keys(*'beta')
        c('C-s beta', found(), ['beta', 'p2'])
        wd.keys('RET')
        c('RET closes', [opened(), found()], [False, ['beta', 'p2']])

        start(); wd.keys('C-s', *'alpha')
        c('C-s alpha', found(), ['alpha', 'p1'])
        wd.keys('C-s'); c('C-s again', found(), ['alpha', 'p3'])
        wd.keys('C-s'); c('smart case: alpha matches Alpha', found(), ['Alpha', 'p4'])
        wd.keys('C-s'); c('failing search keeps the match', found(), ['Alpha', 'p4'])
        wd.keys('C-s'); c('wraps around', found(), ['alpha', 'p1'])
        wd.keys('C-r'); c('C-r at the first match fails', found(), ['alpha', 'p1'])
        wd.keys('C-r'); c('C-r again wraps to the last', found(), ['Alpha', 'p4'])
        wd.keys('C-r'); c('C-r goes back', found(), ['alpha', 'p3'])
        wd.keys('RET')

        start(); wd.keys('C-s', *'Alpha')
        c('smart case: Alpha is case-sensitive', found(), ['Alpha', 'p4'])
        wd.keys('RET')

        start(); wd.keys('C-s', 'C-s')
        c('C-s C-s repeats the last search', found(), ['Alpha', 'p4'])
        wd.keys('RET')

        start(); wd.keys('C-r', *'alpha')
        c('C-r from the top finds nothing', found(), None)
        wd.keys('C-g')

        start(); wd.keys('C-s', *'alphx', 'C-h', 'a')
        c('C-h edits the minibuffer', found(), ['alpha', 'p1'])
        wd.keys('C-a', 'C-k', *'three')
        c('C-a C-k edit the minibuffer', found(), ['three', 'p3'])
        wd.keys('RET')

        start(); wd.keys('C-s', *'日本語')
        c('C-s Japanese', found(), ['日本語', 'p6'])
        wd.keys('ESC')
        c('ESC accepts', [opened(), found()], [False, ['日本語', 'p6']])

        start(); wd.keys('C-s', *'bottomword')
        c('C-s scrolls to the match', wd.js('return scrollY > 1000;'), True)
        wd.keys('C-g')
        c('C-g restores scroll and selection',
          [opened(), wd.js('return scrollY;'), found()], [False, 0, None])

        wd.js("document.querySelector('#ta').focus();")
        wd.keys('C-s', *'beta', 'C-g')
        c('C-g restores the focus', wd.js('return document.activeElement.id;'), 'ta')

        start(); wd.keys('C-s', *'linktarget', 'RET')
        c('RET on a link focuses it', wd.js('return document.activeElement.id;'), 'link')

        start(); wd.js('window.pageKeys = 0;')
        wd.keys('C-s', *'jkl', 'C-h', 'RET')
        c('minibuffer keys hidden from page', wd.js('return window.pageKeys;'), 0)

        # C-x b
        first = wd.call('WebDriver:GetWindowHandle')
        self.goto('index.html')
        handles = [first]
        for page in ['view.html', 'app.html']:
            h = wd.call('WebDriver:NewWindow', {'type': 'tab'})['handle']
            wd.call('WebDriver:SwitchToWindow', {'handle': h})
            self.goto(page)
            handles.append(h)
        selected = lambda: self.chrome_js('return gBrowser.tabs.indexOf(gBrowser.selectedTab);')
        blur = lambda: wd.js('document.activeElement.blur();')

        blur(); wd.keys('C-x', 'b'); time.sleep(0.3)
        c('C-x b opens the minibuffer', opened(), True)
        wd.keys('RET'); time.sleep(0.3)
        c('C-x b RET: the previous tab', selected(), 1)

        wd.call('WebDriver:SwitchToWindow', {'handle': handles[1]})
        blur(); wd.keys('C-x', 'b'); time.sleep(0.3)
        wd.keys(*'app-like', 'RET'); time.sleep(0.3)
        c('C-x b filters', selected(), 2)

        wd.call('WebDriver:SwitchToWindow', {'handle': handles[2]})
        blur(); wd.keys('C-x', 'b'); time.sleep(0.3)
        wd.keys(*'test prototype', 'RET'); time.sleep(0.3)
        c('C-x b: every word must match', selected(), 0)

        wd.call('WebDriver:SwitchToWindow', {'handle': handles[0]})
        blur(); wd.keys('C-x', 'b'); time.sleep(0.3)
        wd.keys('C-n', 'RET'); time.sleep(0.3)
        c('C-x b C-n: the second candidate', selected(), 1)

        wd.call('WebDriver:SwitchToWindow', {'handle': handles[1]})
        blur(); wd.keys('C-x', 'b'); time.sleep(0.3)
        wd.keys('C-g'); time.sleep(0.3)
        c('C-x b C-g', [opened(), selected()], [False, 1])

        for h in handles[1:]:
            wd.call('WebDriver:SwitchToWindow', {'handle': h})
            wd.call('WebDriver:CloseWindow')
        wd.call('WebDriver:SwitchToWindow', {'handle': first})

    def options_url(self):
        host = self.chrome_js("return WebExtensionPolicy.getByID(%s).mozExtensionHostname;"
                              % json.dumps(ADDON_ID))
        return 'moz-extension://%s/options.html' % host

    def open_options(self):
        self.wd.call('WebDriver:Navigate', {'url': self.options_url()})
        time.sleep(0.5)

    def settings(self, options=None, keys=None):
        """Store settings directly, then come back to index.html."""
        self.open_options()
        self.wd.call('WebDriver:ExecuteAsyncScript', {'script': """
            const done = arguments[arguments.length - 1];
            browser.storage.local.set({options: arguments[0], keys: arguments[1]}).then(done);
        """, 'args': [options or {}, keys or {}]})
        self.goto('index.html')

    def run_settings(self):
        wd, c = self.wd, self.check
        H = 'hello\nworld'
        put = lambda kind, name, value: wd.js("""
            const el = document.getElementById(arguments[0] + '-' + arguments[1]);
            if (el.type === 'checkbox') el.checked = arguments[2]; else el.value = arguments[2];
            el.dispatchEvent(new Event('input', {bubbles: true}));
        """, kind, name, value)
        state = lambda name: wd.js("""
            return [document.getElementById('problem-' + arguments[0]).textContent,
                    document.getElementById('save').disabled];
        """, name)

        # The options page
        self.goto('index.html')
        page = wd.call('WebDriver:GetWindowHandle')
        opts = wd.call('WebDriver:NewWindow', {'type': 'tab'})['handle']
        wd.call('WebDriver:SwitchToWindow', {'handle': opts})
        self.open_options()
        commands = len(re.findall(r"^\s+\['(?:Edit|View|Common)',",
                                  open(os.path.join(EXT, 'defaults.js')).read(), re.M))
        c('options page lists every command',
          wd.js('return document.querySelectorAll("tr").length;'), commands)
        c('options page shows the defaults',
          wd.js('return [document.getElementById("key-Undo").value,'
                ' document.getElementById("opt-UseAlt").checked];'), ['C-x u', True])
        c('nothing to save at first', state('NextChar'), ['', True])
        put('key', 'NextChar', 'C-foo')
        c('invalid key', state('NextChar'), ['Invalid key', True])
        put('key', 'NextChar', 'C-b')
        c('duplicate key', state('NextChar'), ['Also bound to PreviousChar', True])
        put('key', 'NextChar', 'C-x')
        c('prefix key', state('NextChar'), ['C-x is a prefix key', True])
        put('opt', 'TurnoffRegex', '(')
        c('invalid regex', state('opt-TurnoffRegex')[0].startswith('Invalid regular expression'), True)
        put('opt', 'TurnoffRegex', '')
        put('key', 'NextChar', 'C-t')
        c('valid change can be saved', state('NextChar'), ['', False])
        wd.js("document.getElementById('save').click();")
        time.sleep(0.5)
        c('saved', wd.js("return document.getElementById('status').textContent;"), 'Saved')
        c('only differences are stored', wd.call('WebDriver:ExecuteAsyncScript', {'script': """
            const done = arguments[arguments.length - 1];
            browser.storage.local.get(null).then(s => done(s.keys));
        """}), {'NextChar': 'C-t'})

        # Keys kept by Firefox (reserved keys) are warned about, not refused.
        wd.call('WebDriver:Navigate', {'url': self.options_url() + '?os=mac'})
        time.sleep(0.5)
        c('mac: no reserved keys', [state('NextLine'),
          wd.js("return document.getElementById('reserved').hidden;")], [['', True], True])
        for os_name, quit_key, other in [('linux', 'C-q', 'C-Q'), ('win', 'C-Q', 'C-q')]:
            wd.call('WebDriver:Navigate', {'url': self.options_url() + '?os=' + os_name})
            time.sleep(0.5)
            c(os_name + ': note shown', wd.js(
                "return !document.getElementById('reserved').hidden &&"
                " document.getElementById('reserved').textContent.includes('C-w (close tab)');"), True)
            c(os_name + ': C-n warned', state('NextLine')[0].startswith(
                'C-n is kept by Firefox for "new window"'), True)
            c(os_name + ': C-w warned', state('KillRegion')[0].startswith('C-w is kept by Firefox'), True)
            c(os_name + ': warnings counted', wd.js(
                "return document.getElementById('status').textContent;"),
              '4 keys do not reach Firemacs on this system')   # C-n twice, C-w, C-t saved above
            put('key', 'NextChar', quit_key)
            c(os_name + ': ' + quit_key + ' warned, can be saved', [state('NextChar')[0].startswith(
                quit_key + ' is kept by Firefox for "quit"'), state('NextChar')[1]], [True, False])
            put('key', 'NextChar', other)
            c(os_name + ': ' + other + ' not warned', state('NextChar')[0], '')
            put('key', 'NextChar', 'C-x C-w')
            c(os_name + ': second key warned', state('NextChar')[0].startswith('C-w is kept'), True)
            put('opt', 'XPrefix', 'C-t')
            c(os_name + ': XPrefix warned', state('opt-XPrefix')[0].startswith('C-t is kept'), True)
            c(os_name + ': key after XPrefix warned', state('Undo')[0].startswith('C-t is kept'), True)
        wd.call('WebDriver:Navigate', {'url': self.options_url()})
        time.sleep(0.5)

        # Applied to the page already open, without reloading it.
        wd.call('WebDriver:SwitchToWindow', {'handle': page})
        c('new key works in an open page', self.text(H, 0, 'C-t')[:3], [H, 1, 1])

        wd.call('WebDriver:SwitchToWindow', {'handle': opts})
        wd.js("document.getElementById('reset').click();")
        c('reset restores defaults',
          wd.js("return document.getElementById('key-NextChar').value;"), 'C-f')
        wd.js("document.getElementById('save').click();")
        time.sleep(0.5)
        wd.call('WebDriver:CloseWindow')
        wd.call('WebDriver:SwitchToWindow', {'handle': page})
        c('default key back', self.text(H, 0, 'C-f')[:3], [H, 1, 1])

        # Options
        self.settings(keys={'NextWord': 'C-t'})
        c('rebound: new key', self.text('foo bar', 0, 'C-t')[:3], ['foo bar', 3, 3])
        c('rebound: old key unbound', self.text('foo bar', 0, 'M-f')[:3] != ['foo bar', 3, 3], True)

        self.settings(keys={'NextWord': ''})
        c('empty key disables', self.text('foo bar', 0, 'M-f')[:3] != ['foo bar', 3, 3], True)

        self.settings(options={'XPrefix': 'C-t'})
        c('XPrefix C-t: C-t u', self.text('foo bar', 3, 'C-k', 'C-t', 'u')[0], 'foo bar')
        c('XPrefix C-t: C-t h', self.text(H, 3, 'C-t', 'h')[:3], [H, 0, 11])

        self.settings(options={'UseEscape': False})
        c('UseEscape off', self.text('foo bar', 0, 'ESC', 'f')[:3], ['ffoo bar', 1, 1])
        c('UseEscape off: C-[ still works', self.text('foo bar', 0, 'C-[', 'f')[:3], ['foo bar', 3, 3])

        self.settings(options={'UseAlt': False})
        c('UseAlt off', self.text('foo bar', 0, 'M-f')[:3] != ['foo bar', 3, 3], True)

        self.settings(options={'UseMeta': True})
        c('UseMeta on: Cmd-f', self.text('foo bar', 0, 'Cmd-f')[:3], ['foo bar', 3, 3])

        self.settings(options={'WalkForm': False})
        c('WalkForm off', self.text('first input', 11, 'C-n', sel='#in1')[3], 'in1')

        self.settings(options={'EditOnly': True})
        c('EditOnly: edit keys work', self.text(H, 0, 'C-f')[:3], [H, 1, 1])
        self.goto('view.html')
        wd.js('document.activeElement.blur(); scrollTo(0, 0);')
        wd.keys('j', 'C-v')
        c('EditOnly: no view/common keys', wd.js('return scrollY;'), 0)

        tooltip = lambda: self.chrome_js(
            "return document.getElementById(%s)" % json.dumps(BUTTON_ID) +
            ".getAttribute('tooltiptext');")
        self.settings(options={'TurnoffRegex': 'view\\.html'})
        c('TurnoffRegex: other pages work', self.text(H, 0, 'C-f')[:3], [H, 1, 1])
        c('TurnoffRegex: icon on other pages', tooltip(), 'Firemacs enabled')
        self.goto('view.html')
        wd.js('document.activeElement.blur(); scrollTo(0, 0);')
        wd.keys('j')
        c('TurnoffRegex: turned off', wd.js('return scrollY;'), 0)
        c('TurnoffRegex: icon in the tab', tooltip(), 'Firemacs turned off on this page')
        self.goto('index.html')
        c('TurnoffRegex: icon back', tooltip(), 'Firemacs enabled')

        self.settings()
        c('AccessRegex default keeps access keys',
          wd.js("return document.querySelectorAll('[accesskey]').length;"), 1)
        self.settings(options={'AccessRegex': 'index'})
        c('AccessRegex kills access keys',
          wd.js("return document.querySelectorAll('[accesskey]').length;"), 0)
        self.settings()

    def visual_line_starts(self, selector, text):
        """Offsets at the left edge of each visual line of the real textarea."""
        return self.wd.js("""
            const ta = document.querySelector(arguments[0]);
            ta.value = arguments[1];
            ta.scrollTop = 0;
            const cs = getComputedStyle(ta);
            const r = ta.getBoundingClientRect();
            const left = r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
            const top = r.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
            const bottom = Math.min(r.bottom, top + ta.scrollHeight) - 3;
            const starts = [];
            for (let y = top + 3; y < bottom; y += 2) {
                const p = document.caretPositionFromPoint(left + 0.3, y);
                if (p && starts[starts.length - 1] !== p.offset) starts.push(p.offset);
            }
            return starts;
        """, selector, text)

    def select_text(self, selector, text):
        """Put text into the element and select it, with no field focused."""
        self.wd.js("""
            document.activeElement.blur();
            const el = document.querySelector(arguments[0]);
            el.textContent = arguments[1];
            getSelection().selectAllChildren(el);
        """, selector, text)

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
        tests.run_common()
        tests.run_minibuffer()
        tests.run_settings()
        print('\n%d passed, %d failed' % (tests.passed, tests.failed))
        return 1 if tests.failed else 0
    finally:
        firefox.terminate()
        firefox.wait()
        server.shutdown()
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
