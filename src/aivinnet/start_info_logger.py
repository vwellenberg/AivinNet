from aivinnet.settings import TCOLOR, Metadata, Paths
from aivinnet.utils.network import get_ip


def reachable_addresses(host: str) -> list[str]:
    """
    The addresses a browser can actually open for a server bound to `host`.

    ⚠️ Wildcard bind addresses mean "listen on every interface" — they are not
    destinations. A browser pointed at http://0.0.0.0 gets "site can't be
    reached" on Windows (and Chrome blocks it outright), so they are replaced by
    the loopback and LAN addresses they stand for.

    "::" only promises IPv6: whether it also accepts IPv4 depends on the OS
    (Windows defaults to IPV6_V6ONLY=1), so only the IPv6 loopback is listed.
    """
    if host in ("0.0.0.0", ""):
        lan_ip = get_ip()
        return ["127.0.0.1"] + ([lan_ip] if lan_ip else [])

    if host == "::":
        return ["::1"]

    return [host]


def log_startup_info(host: str, port: int):
    print(f"{TCOLOR.HEADER}AivinNet v{Metadata.version} {TCOLOR.ENDC}")

    print("Server running on:\n")
    for address in reachable_addresses(host):
        # IPv6 literals need brackets in a URL, or the port is read as part of them.
        url_host = f"[{address}]" if ":" in address else address
        print(f"{TCOLOR.OKGREEN}http://{url_host}:{port}{TCOLOR.ENDC}")

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
