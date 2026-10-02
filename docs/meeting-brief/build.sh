#!/bin/sh
# Build the meeting brief PDF. Run from this directory: ./build.sh
set -e
cd "$(dirname "$0")"
pdflatex -interaction=nonstopmode -halt-on-error main.tex >build1.log 2>&1 || {
  echo "First pass failed -- see build1.log"; exit 1; }
pdflatex -interaction=nonstopmode -halt-on-error main.tex >build2.log 2>&1 || {
  echo "Second pass failed -- see build2.log"; exit 1; }
rm -f main.aux main.log main.out main.toc build1.log build2.log
echo "OK: $(pwd)/main.pdf"
