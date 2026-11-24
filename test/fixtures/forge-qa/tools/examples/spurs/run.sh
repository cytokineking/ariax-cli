#!/bin/sh
set -eu
out=${1:-/workspace/spurs-example}
spurs score --model single --pdb /inputs/spurs/DOCK1_MOUSE.pdb --chain A --mutations /inputs/spurs/mutations.json --output "$out/single"
spurs score --model single --pdb /inputs/spurs/DOCK1_MOUSE-offset.pdb --chain A --mutations /inputs/spurs/mutations.json --output "$out/numbering"
spurs scan --pdb /inputs/spurs/DOCK1_MOUSE.pdb --chain A --output "$out/scan"
spurs score --model higher-order --pdb /inputs/spurs/DOCK1_MOUSE.pdb --chain A --mutations /inputs/spurs/doubles.json --output "$out/higher-order"
spurs functional-sites --method paper --pdb /inputs/spurs/DOCK1_MOUSE.pdb --chain A --output "$out/functional"
spurs functional-sites --method native-notebook --pdb /inputs/spurs/DOCK1_MOUSE.pdb --chain A --output "$out/functional-native"
python /inputs/spurs/check.py "$out"
