#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "1. Building Vite web assets..."
npm run build

echo "2. Compiling native macOS Swift executable..."
swiftc -O -target arm64-apple-macos12.0 native-app/main.swift -o native-app/AthenaExam

echo "3. Constructing macOS App Bundle..."
APP_DIR="release/Athena Exam.app"
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources"

cp native-app/AthenaExam "$APP_DIR/Contents/MacOS/AthenaExam"
cp -R dist "$APP_DIR/Contents/Resources/dist"

cat << 'EOF' > "$APP_DIR/Contents/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>AthenaExam</string>
    <key>CFBundleIdentifier</key>
    <string>com.athena.exam</string>
    <key>CFBundleName</key>
    <string>Athena Exam</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>LSMinimumSystemVersion</key>
    <string>12.0</string>
    <key>NSCameraUsageDescription</key>
    <string>Athena Exam requires camera access for exam proctoring.</string>
    <key>NSMicrophoneUsageDescription</key>
    <string>Athena Exam requires audio access for exam verification.</string>
</dict>
</plist>
EOF

echo "4. Packaging DMG image..."
STAGING="release/dmg-staging"
rm -rf "$STAGING"
mkdir -p "$STAGING"
cp -R "$APP_DIR" "$STAGING/"
ln -s /Applications "$STAGING/Applications"

rm -f "release/Athena-Exam-1.0.0-Lite.dmg"
hdiutil create -srcfolder "$STAGING" -volname "Athena Exam" -format UDZO -ov "release/Athena-Exam-1.0.0-Lite.dmg"
rm -rf "$STAGING"

DMG_SIZE=$(du -h "release/Athena-Exam-1.0.0-Lite.dmg" | cut -f1)
echo "✅ Successfully generated release/Athena-Exam-1.0.0-Lite.dmg ($DMG_SIZE)"
