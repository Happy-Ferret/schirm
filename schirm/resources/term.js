// Redesign of the Schirm API using a js object pattern
// goal: reuse this code to create embedded terminals

var SchirmTerminal = function(parentElement, termId, webSocketUrl) {
    // When a termId & iframeId is given, the resulting terminal will act as an
    // embedded terminal running inside a main terminals iframe line.

    var termMarkup = "\
<div class=\"schirm-terminal\">\
    <div class=\"terminal-screen\">\
        <pre class=\"terminal-line-container\"></pre>\
    </div>\
    <pre class=\"terminal-app-container\"></pre>\
</div>\
";

    var self = this;

    var linesElement; // PRE element to render the terminal in line mode
    var appElement;   // PRE element to render the application mode

    var screen0 = 0; // offset from the first line to the current terminal line 0
    var appMode = false;

    this.size = { lines: 0, cols: 0 };

    // keep the current iframe around for debugging
    this.iframe = undefined;

    // IPC

    if (false) {
        var send = function(cmd) {
            // faster than websockets when using an embedded webview
            console.log("schirmcommand" + JSON.stringify(cmd));
        };
        this.send = send;
    } else {
        var preOpenQueue = [];
        var send = function(cmd) {
            // enqueue all messages sent before the websocket is ready
            preOpenQueue.push(cmd);
        };
        self.send = send;

        var socket = new WebSocket(webSocketUrl);
        socket.onopen = function (event) {
            // send enqueued messages
            for (var i=0; i<preOpenQueue.length; i++) {
                socket.send(JSON.stringify(preOpenQueue[i]));
            }
            preOpenQueue = undefined;

            send = function(cmd) { socket.send(JSON.stringify(cmd)); };
            self.send = send;
        };

        socket.onmessage = function (event) {
            eval(event.data);
        }
    }

    // focus

    self.setFocus = function(focus) {
        self.send({cmd:'focus', focus:!!focus});
    };

    // scroll
    self.scroll = function(how) {
        if (how === 'page-up') {
            window.scrollBy(0, window.innerHeight * -0.95);
        } else if (how === 'page-down') {
            window.scrollBy(0, window.innerHeight * 0.95);
        } else if (how === 'top') {
            window.scrollTo(0, 0);
        } else if (how === 'bottom') {
            window.scrollTo(0, 9999999999999);
        }
    };

    // key handling

    // map browser key codes to Gtk key names used in schirm
    // see termkey.py
    var knownKeys = {
        33: 'Page_Up',
        34: 'Page_Down',
        35: 'End',
        36: 'Home',
        45: 'Insert',
        46: 'Delete',

        37: 'Left',
        38: 'Up',
        39: 'Right',
        40: 'Down',

        8:  'BackSpace',
        9:  'Tab',
        13: 'Enter',
        27: 'Esc',

        112: 'F1',
        113: 'F2',
        114: 'F3',
        115: 'F4',
        116: 'F5',
        117: 'F6',
        118: 'F7',
        119: 'F8',
        120: 'F9',
        121: 'F10',
        122: 'F11',
        123: 'F12'
    };

    var sendKeyFn = function(keyname) {
        return function(key) {
            key.name = keyname;
            self.send({cmd:'keypress', key:key});
        }
    };

    var getKeyChordString = function(key) {
        var a = [];
        if (key.shift) { a.push('shift'); }
        if (key.control) { a.push('control'); }
        if (key.alt) { a.push('alt'); }
        if (key.name) {
            a.push(key.name.toLowerCase());
        } else {
            a.push(String.fromCharCode(key.code).toLowerCase());
        }
        return a.join('-');
    };

    var todoFn = function() { return function() { return true }; };
    var chords = {
        // essential shortcuts
        'shift-page_up':   function() { self.scroll('page-up');   return True; },
        'shift-page_down': function() { self.scroll('page-down'); return True; },
        'shift-home':      function() { self.scroll('top');       return True; },
        'shift-end':       function() { self.scroll('bottom');    return True; },

        // paste xselection
        'shift-insert': function() { send({cmd:'paste_xsel'}); },

        // use the browser search
        'control-f':  function() { return false; },
    }

    var handleKeyDown = function(key) {
        var keyChordString = getKeyChordString(key);

        var handler = chords[keyChordString];
        if (handler) {
            return handler();
        }

        // catch control-* sequences
        var asciiA = 65;
        var asciiZ = 90;
        if (key.control && (key.code >= asciiA) && (key.code <= asciiZ)) {
            key.name = String.fromCharCode(key.code);
            self.send({cmd:'keypress', key:key});
            return true;
        }

        // special keys
        if (key.name) {
            self.send({cmd:'keypress', key:key});
            return true;
        }

        return false
    }

    // key events
    if (true) {
        var keyDownProcessed;
        window.onkeydown = function(e) {
            var key = {'name':knownKeys[e.keyCode],
                       'code':e.keyCode,
                       'string': '',
                       'shift': e.shiftKey,
                       'alt':e.altKey,
                       'control':e.ctrlKey};
            if (handleKeyDown(key)) {
                keyDownProcessed = true;
                return false;
            } else {
                keyDownProcessed = false;
                return true;
            }
        };
        window.onkeypress = function(e) {
            var key = {'name':undefined,
                       'string': String.fromCharCode(e.charCode),
                       'shift': e.shiftKey,
                       'alt':e.altKey,
                       'control':e.controlKey};
            if (key.string && !keyDownProcessed) {
                self.send({cmd:'keypress', key:key});
                return true;
            } else {
                return false;
            }
        };

        window.onkeyup = function(e) {
            keyDownProcessed = true;
        };
    }

    // terminal sizing

    // Return the size of a single character in the given PRE element
    var getCharSize = function(preElement) {
        var specimen = document.createElement("span");
        specimen.innerHTML = "x";
        preElement.appendChild(specimen);

        var marginBorderHeight =
                (window.getComputedStyle(specimen, 'margin-top').value || 0) +
                (window.getComputedStyle(specimen, 'border-top').value || 0) +
                (window.getComputedStyle(specimen, 'border-bottom').value || 0) +
                (window.getComputedStyle(specimen, 'margin-bottom').value || 0);

        var marginBorderWidth =
                (window.getComputedStyle(specimen, 'margin-left').value || 0) +
                (window.getComputedStyle(specimen, 'border-left').value || 0) +
                (window.getComputedStyle(specimen, 'border-right').value || 0) +
                (window.getComputedStyle(specimen, 'margin-right').value || 0);

        var size = {width: specimen.offsetWidth + marginBorderWidth,
                    height: specimen.offsetHeight + marginBorderHeight};
        preElement.removeChild(specimen);
        return size;
    };

    // Return the size in lines and columns of the terminals PRE element
    var getTermSize = function(preElement) {
        var blockSize = getCharSize(preElement);
        var cols  = Math.floor(document.body.clientWidth/blockSize.width);
        // No idea why but the size reported by using offsetHeight in
        // getCharSize needs to be decremented by one to get the *real* size
        // of a char block in a pre element. Without this, the line
        // calculation will be inaccurate for large windows and will lead to
        // a few lines of trailing whitespace.
        var lines = Math.floor(document.body.clientHeight/(blockSize.height - 1));

        return { lines: lines, cols: cols };
    };

    // Determine and cache the height of a vertical scrollbar
    var vScrollBarHeight;
    var getVScrollbarHeight = function() {
        var compute = function() {
            var div = document.createElement("div");
            div.style.width = 100;
            div.style.height = 100;
            div.style.overflowX = "scroll";
            div.style.overflowY = "scroll";

            var content = document.createElement("div");
            content.style.width = 200;
            content.style.height = 200;

            div.appendChild(content);
            document.body.appendChild(div);

            var height = 100 - div.clientHeight;

            document.body.removeChild(div);

            if (height > 0) {
                return height;
            } else {
                return 0;
            }
        };

        if (vScrollBarHeight === undefined) {
            vScrollBarHeight = compute();
        }
        return vScrollBarHeight;
    };

    // Determine the new size of the currently active screen and
    // return it by sending JSON encoded mapping of the size to the
    // terminal emulator process
    this.resize = function() {
        self.size = getTermSize(linesElement);
        send({cmd:'resize',
              width:self.size.cols,
              height:self.size.lines});
    };

    // AutoScroll
    // automatically keep the bottom visible unless the user actively scrolls to the top
    var autoScrollActive = true;
    var autoScrollActivationAreaHeight = 10;
    var autoScrollLastHeight;

    // should be bound to terminal scroll events to deactivate
    // autoScroll if user scrolls manually
    this.checkAutoScroll = function() {
        if (autoScrollLastHeight == parentElement.scrollHeight) {
            // Whenever the user scrolls withing
            // autoScrollActivationAreaHeight pixels to the bottom,
            // automatically keep bottom content visible (==
            // scroll automatically)
            if ((parentElement.scrollTop + parentElement.clientHeight) > (parentElement.scrollHeight - autoScrollActivationAreaHeight)) {
                autoScrollActive = true;
            } else {
                autoScrollActive = false;
            }
        } else {
            // scroll event had been fired as result of adding lines
            // to the terminal and thus increasing its size, do not
            // deactivate autoscroll in that case
            autoScrollLastHeight = parentElement.scrollHeight;
        }
    }

    var autoScroll = function() {
        if (autoScrollActive) {
            // scroll to the bottom
            parentElement.scrollTop = parentElement.scrollHeight - parentElement.clientHeight;
        }
    };
    this.autoScroll = autoScroll;

    // terminal render functions

    // adjust layout to 'render' empty lines at the bottom
    var adjustTrailingSpace = function() {
        if (linesElement.childNodes.length && ((linesElement.childNodes.length - screen0) <= self.size.lines)) {
            var historyHeight = linesElement.childNodes[screen0].offsetTop;
            // position the <pre> so that anything above the screen0 line is outside the termscreen client area
            linesElement.style.setProperty("top", -historyHeight);
            // set the termscreen div margin-top so that it covers all history lines (lines before line[screen0])
            linesElement.parentElement.style.setProperty("margin-top", historyHeight);
        }
        autoScroll();
    };
    this.adjustTrailingSpace = adjustTrailingSpace;

    var checkHistorySizePending = false;
    this.checkHistorySize = function() {
        // generate an remove_history event if necessary

        // only check and generate the remove_history event if there is
        // no event waiting to be processed
        if (!checkHistorySizePending) {
            var maxHistoryHeight = 10000; // in pixels
            var start = screen0;
            var historyHeight = linesElement.childNodes[start].offsetTop;

            if (historyHeight > maxHistoryHeight) {
                for (var i=0; i<start; i++) {
                    if ((historyHeight - linesElement.childNodes[i].offsetTop) < maxHistoryHeight) {
                        send({cmd:'removehistory',
                              n:i});
                        checkHistorySizePending = true; // change state: wait for the removeHistory response
                        return
                    }
                }
            }
        }
    };

    // remove all history lines from 0..n
    this.removeHistoryLines = function(n) {
        for (var i=0; i<n; i++) {
            linesElement.removeChild(linesElement.firstChild);
        }
        checkHistorySizePending = false;
    };

    this.setScreen0 = function(s0) {
        screen0 = s0;
        adjustTrailingSpace();
    };

    this.setLine = function(index, content) {
        linesElement.childNodes[index].innerHTML = content + "\n";
    };

    this.insertLine = function(index, content) {
        var span = document.createElement('span');
        span.innerHTML = content + "\n";
        if ((linesElement.children.length) <= index) {
            linesElement.appendChild(span);
        } else {
            linesElement.insertBefore(span, linesElement.childNodes[index]);
        }
        adjustTrailingSpace();
    };

    this.appendLine = function(content) {
        var span = document.createElement("span");
        span.innerHTML = content + "\n";
        linesElement.appendChild(span);
        adjustTrailingSpace();
    };

    this.removeLine = function(index) {
        linesElement.removeChild(linesElement.childNodes[index]);
        adjustTrailingSpace();
    };

    this.removeLastLine = function() {
      linesElement.removeChild(linesElement.lastChild);
      adjustTrailingSpace();
    };

    // clear all a lines and the history
    this.reset = function() {
        linesElement.innerHTML = "";
    };

    // iframe functions

    // insert an iframe 'line' before linenumber
    this.insertIframe = function(index, id, uri) {
        var div = document.createElement('div');
        linesElement.replaceChild(div, linesElement.childNodes[index]);

        var iframe = document.createElement('iframe');
        iframe.addEventListener('webkitTransitionEnd', autoScroll, false);

        // todo: add seamless & sandbox="allow-scripts allow-forms" attributes
        iframe.name = id;
        iframe.id = id;
        div.appendChild(iframe);

        var newline = document.createElement('span');
        newline.innerHTML = "\n";
        div.appendChild(newline);

        term.iframe = iframe; // keep the current iframe around for debugging

        // linemode: iframe grows vertically with content
        //           iframe is as wide as the terminal window
        iframe.style.width = '100%';

        // the iframe must have at least the height of a vertical
        // scrollbar otherwise, artifacts show up when animating the
        // inital resize of an iframe with vertically scrolled content
        iframe.style.minHeight = getVScrollbarHeight();
        iframe.style.height = getVScrollbarHeight();

        adjustTrailingSpace();

        // load the frame document
        iframe.src = uri;

        iframe.focus();

        // keep the current iframe around for debugging
        self.iframe = iframe;
    };

    // call .close on the iframe document.
    this.iframeCloseDocument = function() {
        // todo delete
    };

    // called when entering plain terminal mode
    this.iframeLeave = function() {
        window.focus();
    };

    //
    this.iframeResize = function(frameId, height) {
        var iframe = document.getElementById(frameId);
        iframe.style.height = height;
        autoScroll();
    };

    // begin to render lines in app mode (fullscreen without
    // scrollback)
    var applicationMode = function(enable) {
        //TODO: implement
        // if (appElement) {
        //     app.show(enable);
        //     lines.show(!enable);
        //     state.appmode = enable;
        //     fn.resize(state.size.lines, state.size.lines);
        // }
    };

    // init
    parentElement.innerHTML = termMarkup;
    linesElement = parentElement.getElementsByClassName('terminal-line-container')[0];
    appElement   = parentElement.getElementsByClassName('terminal-app-container')[0];
    self.resize();

    // debug
    this.linesElement = linesElement;

    // focus
    window.onfocus = function() { self.setFocus(true); };
    window.onblur  = function() { self.setFocus(false); };
    if (document.hasFocus()) {
        self.setFocus(true);
    }

    // adaptive autoScroll
    window.onscroll = self.checkAutoScroll;
};
