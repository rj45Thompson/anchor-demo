# How Casement Sheet is tested

`node test_core.js ../index.html` checks the sheet's arithmetic against the numbers printed on the blank sheet.

`node sim_photo.js geom.js 12` makes simulated phone photos with a known answer (a camera model, lens bend, blur, sensor noise) and reports how far the photo's figures land from the truth.

`py drive3.py <folder with test_truth.json and test_photo.jpg> <site root>` drives the page in Chrome at desktop and phone size, with WebGPU on and Anthropic and GitHub stood in at the network, and prints what each step did. `EXPORT_DIR=<folder> node sim_photo.js geom.js` writes the raw test photo and its answer.

The page also carries `SELF_CHECKS`, which it runs in a sealed frame before the chat box may offer a change.
