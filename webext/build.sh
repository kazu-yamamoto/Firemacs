#!/bin/sh
#
# Makes the package to submit to addons.mozilla.org:
#   ../work/firemacs-<version>.zip
#

cd "$(dirname "$0")" || exit 1

version=`sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' manifest.json`

FILES="
manifest.json
background.js
content.js
defaults.js
minibuffer.js
text.js
visual.js
options.html
options.js
icon16.png
icon16gray.png
icon32.png
icon32gray.png
icon48.png
icon96.png
"

mkdir -p ../work
rm -f ../work/firemacs-$version.zip
zip -q -X ../work/firemacs-$version.zip $FILES || exit 1
# The license must come with binary redistributions.
(cd .. && zip -q -X work/firemacs-$version.zip LICENSE) || exit 1
echo ../work/firemacs-$version.zip

#
# End
#
