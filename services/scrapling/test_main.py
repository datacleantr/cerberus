import os
import unittest
from unittest.mock import patch

from security import OutboundSecurityError, require_service_token, validate_outbound_url


PUBLIC_ANSWER = [
    (2, 1, 6, "", ("8.8.8.8", 443)),
]
PRIVATE_ANSWER = [
    (2, 1, 6, "", ("127.0.0.1", 443)),
]


class OutboundUrlSecurityTests(unittest.TestCase):
    def test_accepts_public_https_target(self):
        with patch("security.socket.getaddrinfo", return_value=PUBLIC_ANSWER):
            validate_outbound_url("https://supplier.example/product")

    def test_rejects_credentials_and_nonstandard_port(self):
        with self.assertRaises(OutboundSecurityError) as credentials:
            validate_outbound_url("https://user:pass@supplier.example/product")
        self.assertEqual(credentials.exception.status_code, 400)

        with self.assertRaises(OutboundSecurityError) as port:
            validate_outbound_url("https://supplier.example:8080/product")
        self.assertEqual(port.exception.status_code, 400)

    def test_rejects_local_hostname(self):
        with self.assertRaises(OutboundSecurityError) as caught:
            validate_outbound_url("http://localhost/product")
        self.assertEqual(caught.exception.status_code, 403)

    def test_rejects_any_private_dns_answer(self):
        mixed = PUBLIC_ANSWER + PRIVATE_ANSWER
        with patch("security.socket.getaddrinfo", return_value=mixed):
            with self.assertRaises(OutboundSecurityError) as caught:
                validate_outbound_url("https://supplier.example/product")
        self.assertEqual(caught.exception.status_code, 403)

    def test_enforces_navigation_allowlist_but_can_allow_public_subresource(self):
        with patch.dict(os.environ, {"CRAWLER_ALLOWED_HOSTS": "supplier.example"}, clear=False):
            with patch("security.socket.getaddrinfo", return_value=PUBLIC_ANSWER):
                with self.assertRaises(OutboundSecurityError) as caught:
                    validate_outbound_url("https://other.example/product")
                self.assertEqual(caught.exception.status_code, 403)

                validate_outbound_url(
                    "https://cdn.other.example/app.js",
                    enforce_allowlist=False,
                )


class ServiceTokenTests(unittest.TestCase):
    TOKEN = "a-secure-shared-token-that-is-over-32-characters"

    def test_fails_closed_when_server_token_is_missing(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(OutboundSecurityError) as caught:
                require_service_token(self.TOKEN)
        self.assertEqual(caught.exception.status_code, 503)

    def test_rejects_wrong_token_and_accepts_exact_token(self):
        with patch.dict(os.environ, {"SCRAPLING_SERVICE_TOKEN": self.TOKEN}, clear=True):
            with self.assertRaises(OutboundSecurityError) as caught:
                require_service_token("wrong-token")
            self.assertEqual(caught.exception.status_code, 401)
            require_service_token(self.TOKEN)


if __name__ == "__main__":
    unittest.main()
