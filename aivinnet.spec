# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules, collect_data_files
from platform import system, machine
import pathlib

hiddenimports =[]
# hiddenimports += collect_submodules('aivinnet')
datas = [('client.zip', '.')]
datas += collect_data_files('aivinnet', True, excludes=['**/*.py'], includes=['**/*.*'])
datas += collect_data_files('flask_openapi3', True, excludes=['**/*.py'], includes=['**/*.*'])

def getFlaskOpenApiPath():
    return importlib.resources.files("flask_openapi3")



a = Analysis(
    ['run.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name=f'aivinnet_{system().lower()}_{machine().lower()}',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    # NOTE: forward slashes on purpose — Windows accepts them, and the old
    # backslash literal was a non-existent filename on Linux/macOS.
    icon=[pathlib.Path('src/aivinnet/assets/logo-fill.light.ico')],
)

# INFO: No COLLECT block. `EXE(...)` above already receives a.binaries and
# a.datas, which makes this a ONEFILE build landing at `dist/aivinnet_<os>_<arch>`.
# The COLLECT that used to sit here (with the leftover name 'name_test') turned
# the output into `dist/name_test/`, so the release workflow's `dist/aivinnet_*`
# upload glob matched nothing and the release failed.
