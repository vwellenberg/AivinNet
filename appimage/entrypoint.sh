# INFO: bjoern links against libev.so.4, which python-appimage does NOT bundle
# (it packages Python + site-packages only). The release workflow copies the
# runner's libev into $APPDIR/usr/lib, and this line makes the dynamic loader
# prefer it — without it the AppImage only starts on hosts that happen to have
# libev4 installed.
export LD_LIBRARY_PATH="${APPDIR}/usr/lib:${LD_LIBRARY_PATH:-}"

# ⚠️ The interpreter itself, not `usr/bin/python` (#300). python-appimage makes
# that a bash wrapper which starts the real Python as a CHILD, without `exec`:
# `kill` or SIGTERM stopped only the wrapper, and the server kept running as an
# orphan on its port (measured on v2026.10.3). systemd never noticed, its
# KillMode=control-group hits every process; a `--no-autostart` install, a
# test instance or anything stopped by PID did.
#
# Of what the wrapper sets up, two things matter and are repeated here:
# SSL_CERT_FILE for the stdlib's TLS (the bundled OpenSSL knows no system CA
# path; `requests` brings certifi and does not read it), and only when the
# bundle exists, as the wrapper does. Its APPIMAGE_COMMAND is left out on
# purpose: it only turns `sys.executable` into the wrapper, and the bare
# interpreter (what we exec) is a working one.
if [ -f "${APPDIR}/opt/_internal/certs.pem" ]; then
    export SSL_CERT_FILE="${APPDIR}/opt/_internal/certs.pem"
fi

# Found, not spelled out: the directory carries the Python version, and the
# interpreter is the binary named like it (`opt/python3.11/bin/python3.11`, not
# `python3.11-config`). The wrapper stays the fallback, so a changed layout
# still starts; the release workflow refuses to package one ("Verify the AppDir
# is complete"), because the fallback brings the orphan back.
python="${APPDIR}/usr/bin/python"
for dir in "${APPDIR}"/opt/python3.*; do
    if [ -x "${dir}/bin/${dir##*/}" ]; then
        python="${dir}/bin/${dir##*/}"
        break
    fi
done

exec "$python" -m aivinnet --client "${APPDIR}/client" "$@"
