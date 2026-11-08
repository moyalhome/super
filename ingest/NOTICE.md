# Attribution

The scripts chains.py, find_stores.py, prices.py, search.py and basket.py in this folder come from the
`il-supermarket-compare` plugin by Tamar (https://github.com/tamardobrin/claude-plugins), whose plugin.json
declares the MIT license. Copied here as a starting point for this project; modifications are ours.

## Local changes

- `prices.py`: the manufacturer column read the field `manufacturername`, but the price files call it `manufacturename`, so it was always empty. Fixed.
- `chains.py`: longer read timeouts for the Shufersal portal (240 s / 300 s instead of 60 s / 120 s). The portal often needs 30-60 s to answer, and a 60 s limit made it fail from GitHub's servers.
