#!/usr/bin/env bash
# One Bernoulli/Monte-Carlo fill step (driven by the Makefile's cloud rules).
#
# Usage: cloud-step.sh <step-n> <canvas> <count> <outdir> <stem> <src>
#
# Step N: stamp one randomly-rotated instance of <src> at a random position
# onto step N-1's canvas (or a fresh black canvas for step 1), then transform
# the WHOLE canvas (1 random rotation or 2 random shears, chosen per step).
# Emits <outdir>/<stem>_NNN.png and a "[NNN/COUNT] pct% [####....] mode=..."
# progress line.
set -e

n=$((10#${1:?step number})); canvas=${2:?canvas}; count=${3:?count}
out=${4:?outdir}; stem=${5:?stem}; src=${6:?source png}

target="$out/${stem}_$(printf %03d "$n").png"

if [ $((10#$n)) -eq 1 ]; then
	base=$(mktemp /tmp/ewc.XXXXXX.png)
	magick -size "${canvas}x${canvas}" xc:'#000000' -colorspace sRGB PNG24:"$base"
else
	base="$out/${stem}_$(printf %03d $((n - 1))).png"
fi

rot=$((RANDOM % 360))
px=$((RANDOM % canvas - 56)); py=$((RANDOM % canvas - 56))

# Alpha-masked stamp: transparency applied SOLELY to the near-black
# background pixels (fuzz-transparent) — body pixels keep full opacity, so
# whites don't dim and overlapping instances composite cleanly. (Do NOT use
# luminance-as-alpha here: it makes mid-grays semi-transparent and the black
# canvas bleeds through, graying the art.)
stamp=$(mktemp /tmp/ewc.XXXXXX.png)
magick "$src" -fuzz 12% -transparent black "$stamp"

if [ $((RANDOM % 2)) -eq 0 ]; then
	# 1 canvas rotation
	mode=SRT
	args=$(( (RANDOM % 60) - 30 ))
else
	# 2 shears composed into one affine matrix: [[1+ab, a], [b, 1]]
	read -r a b <<< "$(awk 'BEGIN{srand();print rand()*0.6-0.3, rand()*0.6-0.3}')"
	mode=affine
	args=$(awk -v a="$a" -v b="$b" 'BEGIN{printf "%f,%f,%f,%f", 1+a*b, a, b, 1}')
fi

rotimg=$(mktemp /tmp/ewc.XXXXXX.png)
magick "$stamp" -background none -rotate "$rot" "$rotimg"
shadow=$(mktemp /tmp/ewc.XXXXXX.png)
magick "$rotimg" \( +clone -background black -shadow 55x6+0+0 \) +swap -background none -composite "$shadow"

magick "$base" \
	\( "$shadow" -geometry +"$px"+"$py" \) \
	\( "$rotimg" -geometry +"$px"+"$py" \) \
	-composite \
	-define distort:viewport="${canvas}x${canvas}" \
	-virtual-pixel background -background '#000000' \
	-distort "$mode" "$args" \
	PNG24:"$target"
rm -f "$stamp" "$rotimg" "$shadow"
[ $((10#$n)) -eq 1 ] && rm -f "$base"

filled=$(( n * 24 / count ))
bar=$(printf '%*s' "$filled" '' | tr ' ' '#')
pad=$(printf '%*s' $(( 24 - filled )) '' | tr ' ' '.')
printf '[%3d/%3d] %3d%% [%s%s] mode=%s\n' "$n" "$count" \
	$(( n * 100 / count )) "$bar" "$pad" "$mode"
# Machine-readable progress line for the live preview (serve.mjs /cloud).
printf '%03d/%03d %d %s %s\n' "$n" "$count" \
	$(( n * 100 / count )) "$mode" "$(basename "$target")" \
	>> "$out/cloud-progress.log"
