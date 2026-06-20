#!/usr/bin/env bash
set -e

# vibe-splain Clean Room Package Validator
# This script simulates a user installing the package via npx/npm to catch missing dependencies.

echo "📦 Starting Clean Room Package Validation..."

# 1. Build everything
npm run build

# 2. Pack the CLI package
cd packages/cli
PACK_RESULT=$(npm pack --silent)
TARBALL_PATH=$(pwd)/$PACK_RESULT
cd ../..

# 3. Create a temporary directory for the test
TEST_DIR=$(mktemp -d)
echo "🧪 Testing in $TEST_DIR"

# 4. Initialize and install the tarball
cd "$TEST_DIR"
npm init -y --silent
npm install "$TARBALL_PATH" --silent

# 5. Verify the binary starts and can run a basic command
echo "🚀 Verifying binary execution..."
./node_modules/.bin/vibe-splain --help > /dev/null

echo "✅ SUCCESS: Package is portable and self-contained."

# 6. Cleanup
rm -rf "$TEST_DIR"
rm "$TARBALL_PATH"
