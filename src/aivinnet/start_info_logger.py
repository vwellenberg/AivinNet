from aivinnet.settings import TCOLOR, Metadata, Paths
from aivinnet.utils.network import get_ip


def log_startup_info(host: str, port: int):
    print(f"{TCOLOR.HEADER}Swing Music v{Metadata.version} {TCOLOR.ENDC}")

    addresses = [host]

    if host == "0.0.0.0":
        remote_ip = get_ip()
        addresses.extend(["127.0.0.1"] + ([remote_ip] if remote_ip else []))

    print("Server running on:\n")
    for address in addresses:
        print(f"{TCOLOR.OKGREEN}http://{address}:{port}{TCOLOR.ENDC}")

    print(f"\n{TCOLOR.YELLOW}Data folder: {Paths().config_dir}{TCOLOR.ENDC}\n")


def log_generated_admin_password(password: str):
    """
    Show the admin password that was generated for a brand new install.

    ⚠️ This is the ONLY time the plaintext exists. It is printed rather than
    logged through the logging module on purpose: the log file lives inside the
    config directory, and writing the credential there would defeat the point of
    not having one on disk. `--password-reset` is the way back for an operator
    who misses it.
    """
    print(f"\n{TCOLOR.HEADER}A new admin account was created.{TCOLOR.ENDC}")
    print(f"{TCOLOR.OKGREEN}    username: admin{TCOLOR.ENDC}")
    print(f"{TCOLOR.OKGREEN}    password: {password}{TCOLOR.ENDC}")
    print(
        f"\n{TCOLOR.YELLOW}Write it down — it is shown once and is not stored anywhere."
        f"\nSet AIVINNET_ADMIN_PASSWORD before the first start to choose it yourself,"
        f"\nor run `aivinnet --password-reset` if you lose it.{TCOLOR.ENDC}\n"
    )
