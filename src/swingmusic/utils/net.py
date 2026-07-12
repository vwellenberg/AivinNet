"""
Network helpers.
"""

import socket

from urllib3.util import connection


def prefer_ipv4() -> None:
    """
    Make urllib3/requests connect over IPv4 only.

    On hosts with broken IPv6 routing (e.g. DS-Lite), getaddrinfo returns
    AAAA records first and urllib3 tries every resolved address sequentially,
    each with the full connect timeout — a single outbound request can then
    block for minutes. With an evented single-threaded WSGI server (bjoern)
    that freezes the whole app. Skipping IPv6 addresses entirely mirrors
    NODE_OPTIONS=--dns-result-order=ipv4first used for node tooling on the
    same host.
    """
    connection.allowed_gai_family = lambda: socket.AF_INET
