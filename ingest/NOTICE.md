# Attribution

The scripts chains.py, find_stores.py, prices.py, search.py and basket.py in this folder come from the
`il-supermarket-compare` plugin by Tamar (https://github.com/tamardobrin/claude-plugins), whose plugin.json
declares the MIT license. Copied here as a starting point for this project; modifications are ours.

## Local changes

- `prices.py`: the manufacturer column read the field `manufacturername`, but the price files call it `manufacturename`, so it was always empty. Fixed.
