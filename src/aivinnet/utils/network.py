import socket as Socket


def has_connection(host="google.it", port=80, timeout=3):
    """
    Whether outbound TCP works at all.

    ⚠️ Two things this used to do, and no longer does:

    * `Socket.setdefaulttimeout(timeout)` set the timeout for every socket
      created ANYWHERE in the process from then on, and never put it back. One
      connectivity probe silently gave the whole application a three-second
      socket timeout for the rest of its life. The timeout belongs on this
      socket, not on the process.
    * the socket was never closed. Each call leaked a file descriptor — on a
      long-running server with periodic scans, that accumulates.

    Both are fixed by owning the socket and setting the timeout on it.
    """
    try:
        with Socket.socket(Socket.AF_INET, Socket.SOCK_STREAM) as sock:
            sock.settimeout(timeout)
            sock.connect((host, port))
        return True
    except OSError:
        return False


def get_ip():
    """
    Get the IP address of the current system.
    Will return address of default outgoing chanel.
    """
    soc = Socket.socket(Socket.AF_INET, Socket.SOCK_DGRAM)
    try:
        soc.connect(("8.8.8.8", 80))
    except OSError:
        return None
    ip_address = str(soc.getsockname()[0])
    soc.close()

    return ip_address
