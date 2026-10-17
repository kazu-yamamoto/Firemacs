# ChangeLog for Firemacs

* 5.0 (26 Sep 2026 submitted; 29 Sep 2026 approved)
  * Rewritten as a WebExtension for Firefox 140 and later.
  * `C-n`/`C-p` move by visual lines in a textarea.
  * `C-s`/`C-r` search in a minibuffer, which accepts input methods and highlights all matches.
  * `C-xb` switches tabs with a filter, most recently used first.
  * A new options page where every key can be changed.
  * The toolbar button turns Firemacs on and off.
  * `C-xl`, `C-xg`, `C-xC-f` and the completion menus of the URL bar are gone since extensions cannot do them.
  * On Windows and Linux, `C-n` and `C-w` do not work since Firefox reserves them.
* 4.5 (26 Jun 2014)
  * `C-SPC` is now available on Mac.
  * `C-SPC` resets the old mark.
  * `C-o` opens a line.
  * `C-h` resets the mark.
* 4.4 (28 Feb 2013)
  * Fixing the version check for Firefox 20.
* 4.3 (29 Jun 2011 submitted)
  * Co-existing with Panorama.
  * Tab listing with `C-xb`.
* 4.2 (23 June 2011 submitted; 29 June 2011 approved)
  * Supporting FF5.
  * Stop using jar as archive format.
* 4.1 (14 March 2011 submitted; 17 March 2011 approved)
  * Fixing a double-operated bug on Firefox 3.
* 4.0 (8 March 2011 submitted; 12 March 2011 approved)
  * Supporting FF4.
  * `C-xC-s` is now saving page.
  * `C-xC-e` is searching web.
  * `C-xh` is selecting all.
  * `H` is scrolling left
  * `L` is scrolling right.
* 3.8 (28 January 2010)
  * Supporting Firefox 3.6.
* 3.7 (28 July 2009 submitted; 30 July 2009 approved)
  * Firemacs 3.0 does not work on second or later frames. So, backported the old code.
* 3.6 (7 July 2009 submitted; 17 July 2009 approved)
  * Supporting Firefox 3.5.
  * Detecting FF's version with function definition
  * `C-xC-a` looks up Google Maps with a selected string
  * `C-M-b` copies the title and URL
* 3.5 (10 March 2009 submitted; 15 March 2009 approved)
  * `C-xC-s` web-searches a selected string
  * `C-M-t` copies the title
  * `C-M-u` copies URL
  * Option of Edit area only
  * `C-u` kills the text between the cursor and the beginning of line
  * Fixing the bug of arrow keys vs completion menu
  * Implementing `C-M-`
  * Stopping search with `C-m`
  * Fixing a bug that Firefox 3 beeps if type `C-x` in an Edit area
* 3.4 (23 July 2008 submitted; 23 July 2008 approved)
  * Right click on the status icon displays a menu
  * Firemacs can work on any dialog windows (thanks to Hirano-san)
  * Supporting BonEcho and Minefield
* 3.3 (20 June 2008 submitted; 28 June 2008 approved)
  * Configuration window is now tab based (thanks to Hirano-san)
  * `C-m` generates the Return key code (thanks to Hirano-san)
  * Adding tooltip to status bar icon
  * Supporting Iceweasel
  * Regular expression to turn off
  * Using Alt/Meta as `M-`
* 3.2 (17 May 2008 submitted; 17 June 2008 approved)
  * A bug fix for canceling access key on Firefox 3
  * New icon
  * Status bar icon to enable/disable Firemacs
* 3.1 (14 Mar 2008 submitted; 20 Mar 2008 approved)
  * Down-sizing the icon to 32x32 due to Firefox 3 beta 4
  * Detecting whether or not menu is displayed
* 3.0 (4 Mar 2008 beta release)
  * You can disable `ESC`
  * You can walk any kinds of menu on Firefox 3
  * Search is now available on Firefox 3
* 2.4 (13 Nov 2007 submitted; 28 Nov 2007 approved)
  * You can choose whether or not `C-n`/`C-p` walk through forms. Remove the check from "walk form" if you prefer not to walk through
  * The code has been re-written with design patterns
* 2.3 (20 Sep 2007 submitted; 23 Sep 2007 approved)
  * The arrow keys (`up`, `down`, `right`, `left`) can handle region
  * A command prefix is shown in the status bar
  * The algorithm to find forms has been sophisticated
  * You can specify a regular expression to be matched URL (the default value is "wiki"). Accesskeys in the page matched to the regular expression are automatically removed
  * XPath is used to remove accesskeys
  * Preference Observer is used
  * Naming convention of variables and functions is changed
* 2.2 (20 Aug 2007 submitted; 29 Aug 2007 approved)
  * The alt key is available on Windows/Mac
  * The command prefix (`C-x`) can be configurable
  * A bug fix for the mark
* 2.1 (1 May 2007 submitted; 30 June 2007 released)
  * `C-d` deletes the current character
  * `C-g` hides the Search bar
  * Completely re-written with the Object Oriented style
* 2.0 (5 April 2007 not submitted)
  * Overriding event listeners of, for example, vox or gmail
  * `M-k` removes accesskeys of, for example, wiki or wikipedia
  * `C-.` selects the body. This is convenient if the caret is in an input
  * Key binding is now possible
  * Bug fixes of zero position mark
* 1.1 (1 March 2007 unofficial release)
  * Change `C-u` to `M-v`
  * `C-xs` selects the first submit button. `M-n`/`M-p` can walk around submit buttons
  * `C-xt` selects the first input/textarea. `C-n`/`C-p` can walk around input/textareas. `C-xt` in an input/textarea selects the content body
  * `C-f`/`C-b` in readable area selected the next/prev tab but not its content body. Now they select the body of the next/prev tab
  * Fixing the side-effect of `C-g`
* 1.0 (16 Feb 2007 submitted, 1 March 2007 approved)
  * An XML table for key-binding was introduced to simplify the code
  * `C-k` now can delete an empty line also
  * Configuration for enabling/disabling keybindings (by shirou)
  * `C-x k` closes the current tab
  * `M-delete` deletes a word backward
  * `M-d` deletes a word forward
* 0.10 (29 Jan 2007 submitted, not approved)
  * `C-n` and `C-p` can walk around the completion menus of the URL/Search bar
  * `C-xC-f` opens a file
  * `C-x l` jumps to the URL bar
  * `C-x g` jumps to the Search bar
  * `C-x u` executes undo
  * `M-<` and `M->` selects the region if the mark exists
* 0.9 (26 Jan 2007 approved)
  * Removed the global variables
  * Removed unnecessary files from the contents of the archive
* 0.8 (Not released)
  * Implemented `F` and `R`
  * `C-g` and `M-w` now remove highlight
  * Both `C-s` and `C-r` emulates Emacs with very good manner
  * The firebug icon can be displayed in the status bar
  * Implemented a generic algorithm to see whether or not the current element is writable. Firemacs can co-exist with i-revo but the Firemacs features cannot be used
* 0.7 (The first release to the public)
  * `C-m` now inserts a new line
  * `C-SPC` displays 'Mark set' in the status bar
  * Obsoleted Alt completed
  * Implemented `M-<` and `M->`
  * Firemacs now co-exists the HTML editor of vox.com. Since accesskey of vox.com wins, commands of firemacs cannot be used.
* 0.6
  * Fixed a bug of `C-[`
* 0.5
  * `ESC` now works as Meta
  * `C-[` now also works as Meta
  * Obsoleted `A-w`. Use `C-[ w` instead
* 0.4
  * Search with `C-s`
* 0.3
  * Removing unnecessary code
  * Implemented `A-w`
  * A new icon by Mr. Ohkouchi
