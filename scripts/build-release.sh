#!/bin/bash
set -e

echo "=== Building frontend ==="
npm run build

echo ""
echo "=== Building release binary ==="
cargo build --release -p brother-shell

echo ""
echo "=== Build complete ==="
echo "Binary: target/release/brother-shell"
ls -lh target/release/brother-shell

echo ""
echo "=== Creating .deb package ==="
cargo deb -p brother-shell --no-build 2>&1 || echo "⚠ cargo-deb falhou. Instale com: cargo install cargo-deb"

echo ""
echo "Done!"
