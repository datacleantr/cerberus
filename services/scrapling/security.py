"""Dependency-free outbound URL and service-token policy for the crawler."""

import hmac
import ipaddress
import os
import socket
import urllib.parse


class OutboundSecurityError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def validate_outbound_url(url: str, enforce_allowlist: bool = True) -> None:
    """Reject unsafe targets before each browser request/redirect hop."""
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise OutboundSecurityError(400, "Yalnızca geçerli http/https URL kullanılabilir.")
    if parsed.username or parsed.password:
        raise OutboundSecurityError(400, "Kimlik bilgisi içeren URL kullanılamaz.")
    try:
        port = parsed.port
    except ValueError as error:
        raise OutboundSecurityError(400, "Geçersiz port.") from error
    if port not in (None, 80, 443):
        raise OutboundSecurityError(400, "Yalnızca 80/443 portları kullanılabilir.")

    hostname = parsed.hostname.rstrip(".").lower()
    if (
        hostname == "localhost"
        or hostname == "metadata.google.internal"
        or hostname.endswith((".local", ".internal", ".localhost"))
    ):
        raise OutboundSecurityError(403, "Bu host güvenlik politikası gereği kullanılamaz.")

    allowed = [
        host.strip().lower().lstrip(".")
        for host in os.getenv("CRAWLER_ALLOWED_HOSTS", "").split(",")
        if host.strip()
    ]
    if enforce_allowlist and allowed and not any(
        hostname == host or hostname.endswith("." + host) for host in allowed
    ):
        raise OutboundSecurityError(403, "Bu alan adı crawler izin listesinde değil.")

    try:
        answers = socket.getaddrinfo(
            hostname,
            port or (443 if parsed.scheme == "https" else 80),
            type=socket.SOCK_STREAM,
        )
    except socket.gaierror as error:
        raise OutboundSecurityError(400, "Alan adı çözümlenemedi.") from error
    if not answers:
        raise OutboundSecurityError(400, "Alan adı çözümlenemedi.")
    for answer in answers:
        address = ipaddress.ip_address(answer[4][0].split("%")[0])
        if not address.is_global:
            raise OutboundSecurityError(
                403,
                "Özel veya ayrılmış ağ adreslerine erişim engellendi.",
            )


def require_service_token(provided: str | None) -> None:
    expected = os.getenv("SCRAPLING_SERVICE_TOKEN", "").strip()
    if len(expected) < 32:
        raise OutboundSecurityError(503, "Servis kimlik doğrulaması yapılandırılmamış.")
    if not provided or not hmac.compare_digest(provided, expected):
        raise OutboundSecurityError(401, "Geçersiz servis kimliği.")
