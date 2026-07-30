# INFO: bjoern links against libev.so.4, which python-appimage does NOT bundle
# (it packages Python + site-packages only). The release workflow copies the
# runner's libev into $APPDIR/usr/lib, and this line makes the dynamic loader
# prefer it — without it the AppImage only starts on hosts that happen to have
# libev4 installed.
export LD_LIBRARY_PATH="${APPDIR}/usr/lib:${LD_LIBRARY_PATH:-}"

exec "${APPDIR}/usr/bin/python" -m swingmusic --client "${APPDIR}/client" "$@"
