#!/usr/bin/env python
# -*- coding: utf-8 -*-

# Schirm - a linux compatible terminal emulator providing html modes.
# Copyright (C) 2011  Erik Soehnel
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.

import sys
import signal
import os
import time
import urllib
import threading
import simplejson
import logging
import gtk
import argparse
import warnings
import urlparse
import base64
import pkg_resources
import types

import gui

from webkit_wrapper import GtkThread, EmbeddedWebView, establish_browser_channel, install_key_events
import webkit_wrapper as wr
from promise import Promise
import webserver

import term

state = None
gtkthread = None
run = True

def running():
    global run
    return run

def stop():
    global run
    run = False

def quit():
    try:
        stop()
        os.kill(os.getpid(), 15)
        gtkthread.kill()
    except:
        pass

def get_term_iframe(view, frame):
    """Given a frame, return the frames iframe-mode frame ancestor or None.

    The iframe-mode ancestor is the first child of the root frame (the
    one that contains term.html and the terminal lines.)
    """
    main_frame = view.get_main_frame()
    f = frame
    while 1:
        p = f.get_parent()
        if not p:
            return None # f was the main frame
        elif p == main_frame:
            return f
        else:
            f = p

last_frame = None
def resource_requested_handler(view, frame, resource, request, response):
    (scheme, netloc, path, params, query, fragment) = urlparse.urlparse(request.get_uri())

    mode_frame = get_term_iframe(view, frame) or frame

    if netloc == 'termframe.localhost' and mode_frame.get_name():
        uri = request.get_uri().replace("http://termframe.localhost", "http://{}.localhost".format(mode_frame.get_name()))
        request.set_uri(uri)

    logging.info("{} requested uri: {}".format(mode_frame.get_name() or 'termframe', request.get_uri()))
    return 0

def sample_console_message_handler(view, msg, line, source_id, user_data):
    """
    webView : the object on which the signal is emitted
    message : the message text
    line : the line where the error occured
    source_id : the source id
    user_data : user data set when the signal handler was connected.
    """
    pass

def receive_handler(msg, pty):
    if msg.startswith("schirm"):
        d = simplejson.loads(msg[6:])

        # always set size
        w = d.get('width')
        h = d.get('height')

        if w and h:
            pty.q_resize(int(h), int(w))

        return True

    elif msg.startswith("frame"):
        frame_id = msg[5:msg.find(" ")]
        logging.debug("Log message for iframe {}".format(frame_id))
        if frame_id == str(pty.screen.iframe_id):
            pty.q_write(["\033Rmessage\033;", base64.encodestring(msg[msg.find(" ")+1:]), "\033Q", "\n"])
            return True

    elif msg.startswith("iframeresize"):
        try:
            height = int(msg[len("iframeresize"):])
        except:
            height = None
        if height != None:
            logging.debug("Iframe resize request to {}".format(height))
            pty.q_iframe_resize(height)
            return True
        else:
            return False

    elif msg.startswith("removehistory"):
        n = int(msg[13:])
        pty.q_removehistory(n)
        return True

    else:
        return False # not handled

def keypress_cb(widget, event):
    print "keypress:",event.time, event.keyval, event.string, event.string and ord(event.string)

def handle_keypress(window, event, schirmview, pty, execute):
    """
    Map gtk keyvals/strings to terminal keys.

    Intercept some standard terminal key combos, like
    shift + PageUp/Down for scrolling.
    """

    # KEY_PRESS
    # KEY_RELEASE            time
    #                        state
    #                        keyval
    #                        string
    name = gtk.gdk.keyval_name(event.keyval)

    shift = event.state == gtk.gdk.SHIFT_MASK
    alt = event.state == gtk.gdk.MOD1_MASK
    control = event.state == gtk.gdk.CONTROL_MASK
    #print name, event.string, event, shift, control, alt

    # handle key commands

    # common terminal commands
    if name == 'Page_Up' and shift:
        schirmview.scroll_page_up()
        return True
    elif name == 'Page_Down' and shift:
        schirmview.scroll_page_down()
        return True
    elif name == 'Home' and shift:
        schirmview.scroll_to_top()
        return True
    elif name == 'End' and shift:
        schirmview.scroll_to_bottom()
        return True
    elif name == 'Insert' and shift:
        schirmview.webview.paste_xsel()
        return True

    # custom schirm commands
    elif name == 'S' and event.string == '\x13': # gtk weirdness: uppercase S and \x13 to catch a shift-control-s
        # control-shift-s to search forward
        schirmview.search(forward=True)
        return True
    elif name == 'R' and event.string == '\x12':
        # control-shift-r to search backward
        schirmview.search(forward=False)
        return True
    elif window.focus_widget.get_name() == 'search-entry' \
            and name == 'g' and control:
        # while searching: control-g to hide the searchframe and the searchresult
        schirmview.hide_searchframe()
        return True

    # compute the terminal key
    key = pty.map_key(name, (shift, alt, control))
    if not key:
        if alt:
            key = "\033%s" % event.string
        else:
            key = event.string

    # handle terminal input
    if window.focus_widget.get_name() == 'term-webview':

        if pty.screen.iframe_mode:
            # in iframe mode, only write some ctrl-* events to the
            # terminal process
            if key and \
                    control and \
                    name in "dcz":
                pty.q_write(key)

            # let the webview handle this event
            return False
        else:
            if key:
                pty.q_write(key)

            # no need for the webview to react on key events when not in
            # iframe mode
            return True
    else:
        return False

def check_prepare_path(path):
    """Expand users, absolutify and return path if exists else None."""
    path = os.path.abspath(os.path.expanduser(path))
    if os.path.exists(path):
        return path
    else:
        return None

def init_dotschirm():
    """Create ~/.schirm/ and or missing files in it."""
    if not os.path.exists(os.path.expanduser('~')):
        return

    dotschirm = os.path.expanduser('~/.schirm/')
    if not os.path.exists(dotschirm):
        os.mkdir(dotschirm)

    user_css = os.path.join(dotschirm, 'user.css')
    if not os.path.exists(user_css):
        with open(user_css, 'w') as f:
            f.write(pkg_resources.resource_string("schirm.resources", "user.css"))

def webkit_event_loop(console_log=None, user_css='~/.schirm/user.css'):
    """Setup, initialize and wire the schirm components:

    - the terminal emulator (term, termscreen)
    - the webkit webview (webkit_wrapper)
    - the local proxy webserver (webserver)
    - the thread transporting changes from term -> webkview (pty_loop)
    - the loop reading the webviews console messages

    console_log .. write console.log messages to stdout
      None: don't write them
         1: write the message
         2: write document-URL:line message

    user_css .. path to the user.css file
    """
    init_dotschirm()

    global gtkthread
    gtkthread = GtkThread()

    schirmview = gtkthread.invoke_s(EmbeddedWebView)
    receive, execute = establish_browser_channel(gtkthread, schirmview.webview)

    # exit handler
    gtkthread.invoke(lambda : schirmview.webview.connect('destroy', lambda *args, **kwargs: quit()))

    # rewrite webkit http requests
    gtkthread.invoke(lambda : schirmview.webview.connect('resource-request-starting', resource_requested_handler))

    # terminal focus
    gtkthread.invoke(lambda : schirmview.webview.connect('focus-in-event', lambda *_: pty.q_set_focus(True)))
    gtkthread.invoke(lambda : schirmview.webview.connect('focus-out-event', lambda *_: pty.q_set_focus(False)))

    pty = term.Pty([80,24])
    schirmview.webview.paste_to_pty = pty.paste
    gtkthread.invoke(lambda : install_key_events(schirmview.window, lambda widget, event: handle_keypress(widget, event, schirmview, pty, execute), lambda *_: True))

    # A local webserver to write requests to the PTYs stdin and wait
    # for responses because I did not find a way to mock or get a
    # proxy of libsoup.
    server = webserver.Server(pty, user_css=check_prepare_path(user_css) or 'user.css').start()
    pty.set_webserver(server)
    schirmview.webview.set_proxy("http://localhost:{}".format(server.getport()))

    global state # make interactive development and debugging easier
    state = dict(schirmview=schirmview,
                 receive=receive,
                 execute=execute,
                 pty=pty,
                 server=server)

    # setup onetime load finished handler to track load status of the
    # term.html document
    load_finished = Promise()
    load_finished_id = None
    def load_finished_cb(view, frame, user_data=None):
        load_finished.deliver()
        if load_finished_id:
            schirmview.webview.disconnect(load_finished_id)
    load_finished_id = gtkthread.invoke_s(lambda : schirmview.webview.connect('document-load-finished', load_finished_cb))

    # create and load the term document
    doc = pkg_resources.resource_string("schirm.resources", "term.html")

    gtkthread.invoke(lambda : schirmview.webview.load_uri("http://termframe.localhost/term.html"))
    load_finished.get()

    # start a thread to send js expressions to webkit
    t = threading.Thread(target=lambda : pty_loop(pty, execute, schirmview))
    t.start()

    # read console.log from webkit messages starting with 'schirm'
    # and decode them with json
    while running():

        msg, line, source = receive(block=True, timeout=0.1) or (None, None, None) # timeout to make waiting for events interruptible
        if msg:
            if receive_handler(msg, pty):
                logging.info("webkit-console IPC: {}".format(msg))
            elif console_log == 1:
                print msg
            elif console_log == 2:
                print "{}:{} {}".format(source, line, msg)
    quit()

import cProfile as profile
def pty_loop(pty, execute, schirmview):
    execute("termInit();")
    # p = profile.Profile()
    # p.enable()
    while running() and pty.running():
        for x in pty.read_and_feed_and_render():
            # strings are executed in a js context
            # functions are executed with pty, browser as the arguments
            if isinstance(x, basestring):
                if 'exxitexxitexxitexxit' in x:
                    print "endegelände"
                    # p.disable()
                    # p.dump_stats("schirmprof.pstats")
                    stop()
                execute(x) # TODO: synchronize!!!
                #print "execute: %r" % x[:40]
            elif isinstance(x, types.FunctionType):
                x(pty, schirmview, gtkthread)
            else:
                logging.warn("unknown render event: {}".format(x[0]))

    # p.disable()
    # p.dump_stats("schirmprof.pstats")
    stop()

# def main():
#
#     signal.signal(signal.SIGINT, lambda sig, stackframe: quit())
#     signal.siginterrupt(signal.SIGINT, True)
#
#     parser = argparse.ArgumentParser(description="A linux compatible terminal emulator providing modes for rendering (interactive) html documents.")
#     parser.add_argument("-v", "--verbose", help="be verbose, -v for info, -vv for debug log level", action="count")
#     parser.add_argument("-c", "--console-log", help="write all console.log messages to stdout (use -cc to include document URL and linenumber)", action="count")
#     args = parser.parse_args()
#
#     if args.verbose:
#         logging.basicConfig(level=[None, logging.INFO, logging.DEBUG][args.verbose])
#
#     if not (args.verbose and args.verbose > 1):
#         warnings.simplefilter('ignore')
#
#     try:
#         __IPYTHON__
#         print "IPython detected, starting webkit loop in its own thread"
#         t = threading.Thread(target=webkit_event_loop, args=(args.console_log,))
#         t.start()
#     except:
#         webkit_event_loop(args.console_log)

def main():
    def foo(browser_page):
        print "browser term started"
        browser_page.load_uri("http://www.heise.de")

    gui.start_gui(foo)

if __name__ == '__main__':
    main()
