#!/bin/sh
set -eu

app_path=${1:?Application bundle path is required}
output_path=${2:?Output DMG path is required}
volume_name=${3:-Rollcasters}
staging_dir=$(mktemp -d)
trap 'rm -rf "$staging_dir"' EXIT INT TERM
cp -R "$app_path" "$staging_dir/"
ln -s /Applications "$staging_dir/Applications"
hdiutil create -quiet -ov -volname "$volume_name" -srcfolder "$staging_dir" -format UDZO -imagekey zlib-level=9 "$output_path"
hdiutil verify "$output_path"
