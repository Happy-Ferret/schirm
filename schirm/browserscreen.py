
class BrowserScreen(object):

    def __init__(self):
        self._events = []
        # screen size
        self.lines = 0
        self.columns = 0
        # real rendered lines on the screen and in the scrollback
        self.total_lines = 0
        # offset splitting the line buffer in a scrollback and screen part
        self.line_origin = 0

    def _append(self, ev):
        self._events.append(ev)

    def _compile(self, events):
        return events

    def pop_events(self):
        e = self._events
        self._events = []
        return self._compile(e)

    ### events

    # common args:
    #   cursor position:
    #     x (col, pos)
    #     y (line)
    #   string - a string to insert/replace
    #   attr - tuple of the attributes defined in schirm-cljs.screen.CharacterStyle

    def char_to_attr(self, char):
        """Convert cursor attributes to the format used in schirm-cljs."""
        # TODO: reduce the number of attributes in pyte.Char!!! so we do not need this function any more
        data, fg, bg, bold, italics, underscore, reverse, strikethrough = char
        return (fg, bg, bold, italics, underscore, strikethrough, False)

    def insert(self, line, col, string, attr):
        """Insert string in line at col using the given attributes."""
        self._append(('insert', line, col, string, self.char_to_attr(attr)))

    def insert_overwrite(self, line, col, string, attr):
        """Insert string in line starting at col overwriting existing chars."""
        self._append(('insert-overwrite', line, col, string, self.char_to_attr(attr)))

    def remove(self, line, col, n):
        """Delete n characters from line starting at col."""
        self._append(('remove', line, col, n))

    def insert_line(self, y, attrs=None):
        """Insert a new line at y."""
        # TODO: attrs ????
        #       and why do only some line inserts use 'attrs'?
        self._append(('insert-line', y))

    def remove_line(self, y):
        """remove the line at index y."""
        self._append(('remove-line', y))

    # modify the line origin
    # TODO: move the resize code into the screen-compiler, so that the
    #       BrowserScreen does not have any state except the list of
    #       events
    def set_line_origin(self, line_origin):
        self.line_origin = line_origin
        self._append(('set-line-origin', line_origin))

    def add_line_origin(self, delta):
        self.line_origin += delta
        self._append(('set-line-origin', self.line_origin))

    def reset(self, lines, columns):
        """Reset the browser screen."""
        self.set_line_origin(0)
        self.lines = lines
        self.columns  = columns
        self._append(('reset', lines))

    def resize(self, lines, columns):
        """Resize the browserscreen to lines height and columns width."""
        line_delta = lines - self.total_lines
        remaining_empty_lines = self.total_lines - (len(self.lines) - self.line_origin)
        if line_delta < remaining_empty_lines:
            # when resizing and there are empty lines below the last visible line,
            # keep this line in same place (measured from the top of the terminal window)
            cursor_delta = 0
        else:
            line_origin = self.line_origin
            self.set_line_origin(self.total_lines - lines)
            cursor_delta = line_origin - self.line_origin

        self.lines = lines
        self.columns  = columns

        self._append(('resize', lines))

        return cursor_delta # to be able to compute the new cursorpos

    def reverse_all_lines(self):
        TODO

    def enter_altbuf_mode(self):
        TODO

    def leave_altbuf_mode(self):
        TODO

    # TODO: iframe_* methods

    # def iframe_*(self):
    #     pass

    def remove_history(self, lines):
        TODO

    def set_title(self, string):
        # TODO
        pass
