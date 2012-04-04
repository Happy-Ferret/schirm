
// Return the size of a single character in the given PRE element
function getCharSize(preElement) {
  var specimen = document.createElement("span");
  specimen.innerHTML = "x";
  preElement.appendChild(specimen);
  var size = {width: specimen.offsetWidth, height: specimen.offsetHeight};
  preElement.removeChild(specimen);
  return size;
}

// Return the size in lines and columns
function getTermSize(preElement) {
  var blockSize = getCharSize(preElement);
  var cols  = Math.floor(document.body.clientWidth/blockSize.width);
  var lines = Math.floor(document.body.clientHeight/blockSize.height);
  return { lines: lines, cols: cols };
}

function resizeIframe(iframe) {
  try {
    var doc = iframe.contentDocument.documentElement;
      if (doc) {
        iframe.height = doc.scrollHeight;

        // scrollHeight doesn't include the height of the horizontal
        // scrollbar -> an additional vertical scrollbar appears to
        // still be able to see the whole content (we only want the
        // vertical scrollbar).  therefor: compare to the
        // clientHeight and then adjust the iframe height.
        var rect = doc.getBoundingClientRect();
        if (doc.scrollHeight && doc.clientHeight && doc.scrollHeight > doc.clientHeight) {
          var diff = doc.scrollHeight - doc.clientHeight;
          iframe.height = doc.scrollHeight + diff;
        }
      }
  } catch (e) { }
};

// rendering the terminal in normal mode
// linesElement:
// a PRE element holding the terminals lines
// each line is a span of nested spans for styles
var Lines = (function(linesElement, term) {

  var fn = {

    // pointer to the first terminal line
    screen0: 0,

    init: function() { },

    show: function(enable) {
      linesElement.style.display = enable ? "block" : "none";
    },

    elementIndex: function(lineNumber) {
      return this.screen0 + lineNumber;
    },

    scrollToBottom: function() {
      linesElement.scrollTop = linesElement.scrollHeight;
    },

    scrollPageUp: function() {
      linesElement.scrollTop -= linesElement.offsetHeight;
    },

    scrollPageDown: function() {
      linesElement.scrollTop += linesElement.offsetHeight;
    },

    checkHistorySize: function() {
      // generate an remove history event if necessary

      var maxHistoryHeight = 10000; // in pixels
      var start = this.screen0;
      var historyHeight = linesElement.childNodes[start].offsetTop;

      if (historyHeight > maxHistoryHeight) {
        for (var i=0; i<start; i++) {
          if ((historyHeight - linesElement.childNodes[i].offsetTop) < maxHistoryHeight) {
            console.log('removehistory' + i);
            return
          }
        }
      }
    },

    adjustTrailingSpace: function(visibleLinesStart) {
      var start = (visibleLinesStart == undefined) ? this.screen0 : visibleLinesStart;
      var historyHeight = linesElement.childNodes[start].offsetTop;

      // adjust layout to 'render' empty lines at the bottom
      if (linesElement.childNodes.length && ((linesElement.childNodes.length - this.screen0) < term.size.lines)) {
        // position the <pre> so that anything above the screen0 line is outside the termscreen client area
        linesElement.style.setProperty("top", -historyHeight);
        // set the termscreen div margin-top so that it covers all history lines (lines before line[screen0])
        linesElement.parentElement.style.setProperty("margin-top", historyHeight);
      }
    },

    setScreen0: function(screen0) {
      this.screen0 = screen0;
      this.adjustTrailingSpace(screen0);
    },

    setLine: function(linenumber, content) {
      linesElement.childNodes[this.elementIndex(linenumber)].innerHTML = content + "\n";
    },

    insertLine: function(linenumber, content) {
      var span = document.createElement('span');
      span.innerHTML = content + "\n";
      if ((term.size.lines-1) <= linenumber) {
        linesElement.appendChild(span);
      } else {
        linesElement.insertBefore(span, linesElement.childNodes[this.elementIndex(linenumber)]);
      }
      this.adjustTrailingSpace();
    },

    appendLine: function(content) {
      var span = document.createElement("span");
      span.innerHTML = content + "\n";
      linesElement.appendChild(span);
      this.adjustTrailingSpace();
    },

    removeLine: function(linenumber) {
      linesElement.removeChild(linesElement.childNodes[this.elementIndex(linenumber)]);
      this.adjustTrailingSpace();
    },

    removeLastLine: function() {
      linesElement.removeChild(linesElement.lastChild);
      this.adjustTrailingSpace();
    },

    // remove all history lines from 0..n
    removeHistoryLines: function(n) {
      for (var i=0; i<n; i++) {
        linesElement.removeChild(linesElement.firstChild);
      }
    },

    getSize: function() {
      return getTermSize(linesElement);
    },

    resize: function(oldLines, newLines) {
    },

    // clear all a lines and the history (
    reset: function() {
      linesElement.innerHTML = "";
    },

    // iframe functions
    insertIframe: function (linenumber, id) {
      // insert an iframe 'line' before linenumber
      // close the old iframe
      if (term.currentIframe) {
        try {
          term.currentIframe.contentDocument.close();
        } catch (e) { }
      }

      var div = document.createElement('div');
      linesElement.replaceChild(div, linesElement.childNodes[this.elementIndex(linenumber)]);

      var iframe = document.createElement('iframe');
      iframe.name = id;
      iframe.id = id;
      div.appendChild(iframe);

      // provide a means to send messages to the pty
      iframe.contentWindow.schirmlog = function(msg) { console.log("frame" + id + " " + msg); };

      var newline = document.createElement('span');
      newline.innerHTML = "\n";
      div.appendChild(newline);

      term.currentIframe = iframe;

      // linemode: iframe grows vertically with content
      //           iframe is as wide as the terminal window
      iframe.height = "1";
      iframe.style.width = '100%';

      iframe.resizeHandler = function() { resizeIframe(iframe); };
      iframe.contentDocument.open("text/html");
      this.adjustTrailingSpace();
    },

    // contentDocument.write content (a string) to the currentIframe and
    // resize it (vertically) if necessary
    iframeWrite: function (content) {
      var iframe = term.currentIframe;
      try {
        iframe.contentDocument.write(content);
      } catch (e) {
        iframe.contentDocument.open("text/html");
        iframe.contentDocument.write(content);
      }
      resizeIframe(iframe);
      this.adjustTrailingSpace();
    },

    // call .close on the iframe document.
    iframeCloseDocument: function() {
      var iframe = term.currentIframe;
      resizeIframe(iframe);
      this.adjustTrailingSpace();
      try {
        iframe.contentDocument.close();
        iframe.addEventListener('load', function() { resizeIframe(iframe); });
      } catch (e) { }
    },

    // set the the current iframe document to null
    // so that we know wether were in iframe mode or not
    iframeLeave: function() {
      term.currentIframe = null;
    }

  };

  return fn;
});


// providing a character matrix without history most ncurses
// fullscreen applications seem using this, like midnight commander
var App = (function(appElement, term) {

  var fn = {

    init: function(lines) {
      linesElement.innerHTML = "";
      for (var i=0; i<lines; i++) {
         var span = document.createElement("span");
         linesElement.appendChild(span);
      }
    },

    show: function(enable) {
      appElement.style.display = enable ? "block" : "none";
    },

    elementIndex: function(lineNumber) {
      return lineNumber;
    },

    scrollToBottom: function() { },

    scrollPageUp: function() { },

    scrollPageDown: function() { },

    setLine: function(linenumber, content) {
      appElement.childNodes[this.elementIndex(linenumber)].innerHTML = content + "\n";
    },

    insertLine: function(linenumber, content) {
      var span = document.createElement('span');
      span.innerHTML = content + "\n";
      
      if (term.size.lines <= linenumber) {
        appElement.appendChild(span);
        appElement.removeChild(appElement.firstChild);
      } else {
        appElement.insertBefore(span, appElement.childNodes[this.elementIndex(linenumber)]);
        appElement.removeChild(appElement.lastChild); // ?????
      }
    },

    appendLine: function(content) {      
      appElement.removeChild(appElement.firstChild)
      var span = document.createElement("span");
      span.innerHTML = content + "\n";
      appElement.appendChild(span);
    },

    removeLine: function(linenumber) {
      appElement.removeChild(appElement.childNodes[this.elementIndex(linenumber)]);
    },


    getSize: function() {
      return getTermSize(appElement);
    },

    // Resize the terminal space used to render the screen in
    // application mode
    resize: function(oldLines, newLines) {
      // var curLines = appElement.childNodes.length;
      // if (curLines < newLines) {
      //   for (var i=0; i<(newLines-curLines); i++) {
      //     appElement.appendChild(document.createElement('span'));
      //   }
      // } else {
      //   for (var i=0; i<(curLines-newLines); i++) {
      //     appElement.removeChild(appElement.firstChild);
      //   }
      // }
    },

    reset: function() { // todo: should take lines, cols param
      // appElement.innerHTML = "";

      // for (var i=0; i<term.size.lines; i++) {
      //   var span = document.createElement("span");
      //   appElement.appendChild(span);
      // }
    },

    // iframe
    // TODO
    // insert iframe as large as the whole screen
    // or use a second gtk webview instead - might be safer & more robust
    insertIframe: function (linenumber, id) {
      // close the old iframe
      // if (term.currentIframe) {
      //   term.currentIframe.contentDocument.close();
      // }

      // var div = document.createElement('div');
      // if (term.height <= linenumber) {
      //   linesElement.appendChild(div);
      // } else {
      //   linesElement.insertBefore(div, linesElement.childNodes[linenumber]);
      // }

      // var iframe = document.createElement('iframe');
      // div.appendChild(iframe);

      // var newline = document.createElement('span');
      // newline.innerHTML = "\n";
      // div.appendChild(newline);

      // term.currentIframe = iframe;
      // iframe.height = "1";
      // iframe.contentDocument.open("text/html");
    },

    // contentDocument.write content (a string) to the currentIframe and
    // resize it (vertically) if necessary
    iframeWrite: function(content) {
      var iframe = term.currentIframe;
      iframe.contentDocument.write(content);
    },

    iframeLeave: function(content) {
      term.currentIframe = null;
    }
  };

  return fn;

});

var Term = function() {

  var state = {
    currentIframe: undefined,
    appmode: false,
    size: { lines: 24, cols: 80 } // initial size should be 0,0? or undefined?
  };

  var lines = Lines(document.getElementById('term'), state); // one screen to render lines + history
  var app = App(document.getElementById('app'), state); // the other for rendering a char matrix w/o history

  var fn = {

    getState: function() {
      return state;
    },

    getScreen: function() {
      return state.appmode ? app : lines;
    },

    // Determine the new size of the currently active screen and return
    // it by writing JSON to console.log
    resizeHandler: function(event) {
      oldLines = state.size.lines;
      state.size = fn.getScreen().getSize();
      //fn.getScreen().resize(oldLines, state.size.lines); not required anymore
      // IPC
      console.log('schirm{"width":'+state.size.cols+',"height":'+state.size.lines+'}');
    },

    applicationMode: function(enable) {
      app.show(enable);
      lines.show(!enable);
      state.appmode = enable;
      fn.resize(state.size.lines, state.size.lines);
    },

    scrollToBottom: function() { fn.getScreen().scrollToBottom(); },
    scrollPageUp: function() { fn.getScreen().scrollPageUp(); },
    scrollPageDown: function() { fn.getScreen().scrollPageDown(); },

    setScreen0: function(linenumber) { fn.getScreen().setScreen0(linenumber); },

    setLine: function(linenumber, content) { fn.getScreen().setLine(linenumber, content); },
    insertLine: function(linenumber, content) { fn.getScreen().insertLine(linenumber, content); },
    appendLine: function(content) { fn.getScreen().appendLine(content); },
    removeLine: function(linenumber) { fn.getScreen().removeLine(linenumber); },
    removeLastLine: function() { fn.getScreen().removeLastLine(); },

    removeHistoryLines: function(n) { fn.getScreen().removeHistoryLines(n); },
    checkHistorySize: function() { fn.getScreen().checkHistorySize(); },

    insertIframe: function (linenumber, id) { fn.getScreen().insertIframe(linenumber, id); },
    iframeWrite: function (content) { fn.getScreen().iframeWrite(content); },
    iframeCloseDocument: function() { fn.getScreen().iframeCloseDocument(); },
    iframeLeave: function() { fn.getScreen().iframeLeave(); },

    getSize: function() { return fn.getScreen().getSize(); },
    resize: function(oldLines, newLines) { fn.getScreen().resize(oldLines, newLines); },
    reset: function(lines) { fn.getScreen().reset(lines); },
    init: function(lines) { fn.getScreen().init(lines); }
  };

  return fn;
};