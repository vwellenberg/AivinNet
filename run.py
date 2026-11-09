# Launcher script
import sys
import zipfile
import multiprocessing
from pathlib import Path
import aivinnet.__main__ as app

if __name__ == "__main__":
	# Fixed: freeze_support() must be called immediately to prevent 
	# recursive process spawning and ArgumentParser errors on Windows EXE.
    multiprocessing.freeze_support()
    
    # this entry should only be used by pyinstaller.
    # add freeze support here as pyinstaller uses this entry

    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        # INFO: extract client.zip to sys._MEIPASS
        # The spec bundles it as package data at aivinnet/client.zip, the same file
        # AssetHandler.bundled_zip_path() reads. The bundle root path broke every
        # binary from v2026.10.5 to v2026.11.6.
        with zipfile.ZipFile(Path(sys._MEIPASS) / "aivinnet" / "client.zip", "r") as zip_ref:
            zip_ref.extractall(sys._MEIPASS)

        client = Path(sys._MEIPASS) / "client"
        client_str = str(client)

        sys.argv.extend(["--client", client_str])
        sys.orig_argv.extend(["--client", client_str])

    app.run()
