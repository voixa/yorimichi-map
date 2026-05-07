#!/bin/bash
# Pre-deploy validation: ensure courses.js parses correctly
set -e

cd "$(dirname "$0")/.."

echo "🔍 Validating courses.js..."
node -e "global.window={}; require('./courses.js');
  if (!window.YORIMICHI_COURSES || window.YORIMICHI_COURSES.length === 0) {
    throw new Error('No courses loaded');
  }
  if (!window.YORIMICHI_AREAS || window.YORIMICHI_AREAS.length === 0) {
    throw new Error('No areas loaded');
  }
  console.log('✅ Courses:', window.YORIMICHI_COURSES.length);
  console.log('✅ Areas:', window.YORIMICHI_AREAS.length);
"

echo "🔍 Validating photos.js..."
node -e "global.window={}; require('./photos.js');
  if (!window.YORIMICHI_PHOTOS) throw new Error('No photos loaded');
  if (!window.YORIMICHI_PERKS) throw new Error('No perks loaded');
  console.log('✅ Photos:', Object.keys(window.YORIMICHI_PHOTOS).length);
  console.log('✅ Perks:', Object.keys(window.YORIMICHI_PERKS).length);
"

echo ""
echo "✅ All data files valid. Safe to deploy."
