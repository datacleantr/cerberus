import os
import unittest
from unittest.mock import patch

from parsing import detect_bot_challenge, is_plausible_product, is_valid_gtin, parse_generic
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


class GtinTests(unittest.TestCase):
    """Kontrol hanesi — yanlış UPC Amazon'da yanlış ürüne eşletir."""

    def test_accepts_valid_lengths(self):
        for value in ("036000291452", "0036000291452", "00360002914522", "96385074"):
            self.assertTrue(is_valid_gtin(value), value)

    def test_rejects_bad_check_digit_and_bad_length(self):
        for value in ("036000291453", "0036000291453", "123", "abc", ""):
            self.assertFalse(is_valid_gtin(value), value)


class BotChallengeTests(unittest.TestCase):
    """DataDome engel sayfası 403 + bu gövdeyi döner; JS sürümü de tanımalı."""

    DATADOME = (
        '<html><head><title>vitaminshoppe.com</title></head><body>'
        '<p id="cmsg">Please enable JS and disable any ad blocker</p>'
        "<script>var dd={'rt':'c','host':'geo.captcha-delivery.com'}</script>"
        '<script src="https://ct.captcha-delivery.com/c.js"></script></body></html>'
    )
    CLOUDFLARE = '<html><head><title>Just a moment...</title></head><body>cf-chl-widget /__cf_chl/tk</body></html>'

    def test_detects_datadome(self):
        protection, label = detect_bot_challenge(self.DATADOME)
        self.assertEqual(protection, "datadome")
        self.assertEqual(label, "DataDome")

    def test_detects_cloudflare(self):
        protection, _ = detect_bot_challenge(self.CLOUDFLARE)
        self.assertEqual(protection, "cloudflare")

    def test_ignores_normal_product_page(self):
        protection, _ = detect_bot_challenge(
            '<html><head><script type="application/ld+json">'
            '{"@type":"Product","name":"Vitamin D3"}</script></head><body>product</body></html>'
        )
        self.assertIsNone(protection)


class ProductParsingTests(unittest.TestCase):
    def test_extracts_gtin_and_never_invents_asin(self):
        html = (
            '<html><head><script type="application/ld+json">'
            '{"@context":"https://schema.org","@type":"Product",'
            '"name":"Omega 3 Fish Oil","brand":{"name":"Now Foods"},'
            '"sku":"VS-48210","gtin13":"0036000291452",'
            '"offers":{"@type":"Offer","lowPrice":"8.99","highPrice":"17.99",'
            '"priceCurrency":"USD","availability":"https://schema.org/InStock"}}'
            "</script></head><body></body></html>"
        )
        products = parse_generic(html, "https://www.vitaminshoppe.com/p/omega-3-fish-oil", "vitaminshoppe.com")
        self.assertEqual(len(products), 1)
        product = products[0]
        # Perakende slug'ı ASIN DEĞİLDİR — sahte ASIN üretimi regresyonu.
        self.assertIsNone(product["asinCandidate"])
        self.assertEqual(product["sourceSku"], "VS-48210")
        self.assertEqual(product["gtin"], "0036000291452")
        self.assertEqual(product["price"], 8.99)
        self.assertEqual(product["listPrice"], 17.99)
        self.assertTrue(product["isDiscounted"])
        self.assertEqual(product["discountPct"], 50)

    def test_no_discount_when_single_price(self):
        html = (
            '<html><head><script type="application/ld+json">'
            '{"@context":"https://schema.org","@type":"Product","name":"Creatine",'
            '"gtin13":"0036000291452",'
            '"offers":{"@type":"Offer","price":"24.99","priceCurrency":"USD"}}'
            "</script></head><body></body></html>"
        )
        product = parse_generic(html, "https://www.vitaminshoppe.com/p/creatine", "vitaminshoppe.com")[0]
        self.assertFalse(product["isDiscounted"])
        self.assertIsNone(product["discountPct"])

    def test_keeps_real_amazon_asin(self):
        html = (
            '<html><head><script type="application/ld+json">'
            '{"@context":"https://schema.org","@type":"Product","name":"Creatine",'
            '"offers":{"@type":"Offer","price":"24.99","priceCurrency":"USD"}}'
            "</script></head><body></body></html>"
        )
        product = parse_generic(html, "https://www.amazon.com/dp/B001KV5F1O", "amazon.com")[0]
        self.assertEqual(product["asinCandidate"], "B001KV5F1O")


class PlausibilityTests(unittest.TestCase):
    """SPA iskeleti ve splash screen kayıtları elenmeli.

    Gerçek gözlem: GNC sayfasından "MENA Splash Screen Used by Yotta" adlı
    ürün ve $1299 fiyatı çıkmıştı. Sessizce yanlış ürün, ürün BULAMAMAKTAN
    daha kötüdür: kullanıcı bunu gerçek ürün sanıp satın alma kararına
    dönüştürebilir.
    """

    @staticmethod
    def item(**overrides):
        base = {
            "title": "NOW Foods Vitamin D-3 5,000 IU 240 Softgels",
            "brand": "NOW",
            "price": 11.99,
            "gtin": "0036000291452",
            "sourceSku": "NF_0373",
        }
        base.update(overrides)
        return base

    def test_accepts_real_product(self):
        self.assertTrue(is_plausible_product(self.item()))

    def test_rejects_splash_screen(self):
        self.assertFalse(is_plausible_product(self.item(title="MENA Splash Screen Used by Yotta")))

    def test_rejects_domain_as_title(self):
        self.assertFalse(is_plausible_product(self.item(title="lifesupplementstore.com", brand="", gtin=None, sourceSku=None)))

    def test_rejects_error_page(self):
        self.assertFalse(is_plausible_product(self.item(title="The Page is Not Found!")))
        self.assertFalse(is_plausible_product(self.item(title="404 - Page Not Found")))

    def test_rejects_absurd_price(self):
        # Stok adedi / ürün numarası / sent hatası yanlış alandan okunmuş olabilir.
        self.assertFalse(is_plausible_product(self.item(price=9999.0)))
        self.assertFalse(is_plausible_product(self.item(price=0.01)))
        # Gerçek bir yüksek değerli takviye paketi geçmeli.
        self.assertTrue(is_plausible_product(self.item(price=899.0)))

    def test_rejects_skeleton_without_identity(self):
        # Ne fiyat ne GTIN ne marka ne SKU → bu bir ürün değil, iskelettir.
        self.assertFalse(is_plausible_product(self.item(price=None, gtin=None, brand="", sourceSku=None)))


if __name__ == "__main__":
    unittest.main()
