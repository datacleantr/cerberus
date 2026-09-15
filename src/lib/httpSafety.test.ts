import { describe, expect, it } from "vitest";
import {
  isPublicIpAddress,
  readResponseBytesWithLimit,
  validateOutboundUrlSyntax,
} from "./httpSafety";

describe("crawler outbound URL security", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.20.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
  ])("özel/ayrılmış IP adresini engeller: %s", (address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])(
    "genel internete açık IP adresine izin verir: %s",
    (address) => {
      expect(isPublicIpAddress(address)).toBe(true);
    }
  );

  it("obfuscated loopback ve metadata URL'lerini engeller", () => {
    expect(() => validateOutboundUrlSyntax("http://2130706433/path")).toThrow(/ağ adres/);
    expect(() => validateOutboundUrlSyntax("http://169.254.169.254/latest/meta-data")).toThrow(
      /ağ adres/
    );
    expect(() => validateOutboundUrlSyntax("http://metadata.google.internal/")).toThrow(
      /güvenlik/
    );
  });

  it("kimlik bilgisi, özel port ve web dışı protokolü reddeder", () => {
    expect(() => validateOutboundUrlSyntax("https://user:pass@example.com/")).toThrow(
      /Kullanıcı bilgisi/
    );
    expect(() => validateOutboundUrlSyntax("https://example.com:8443/")).toThrow(/port/);
    expect(() => validateOutboundUrlSyntax("file:///etc/passwd")).toThrow(/http\/https/);
  });

  it("opsiyonel host izin listesini alt alan adlarıyla uygular", () => {
    expect(
      validateOutboundUrlSyntax("https://shop.example.com/product", {
        allowedHosts: ["example.com"],
      }).hostname
    ).toBe("shop.example.com");
    expect(() =>
      validateOutboundUrlSyntax("https://example.net/product", {
        allowedHosts: ["example.com"],
      })
    ).toThrow(/izin listesinde değil/);
  });
});

describe("bounded HTTP response reader", () => {
  it("Content-Length olmasa da akış sınırını uygular", async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.enqueue(new Uint8Array([4, 5, 6]));
          controller.close();
        },
      })
    );

    await expect(readResponseBytesWithLimit(response, 5)).rejects.toThrow(/sınırını aşıyor/);
  });

  it("sınır içindeki parçaları birleştirir", async () => {
    const bytes = await readResponseBytesWithLimit(new Response("cerberus"), 32);
    expect(new TextDecoder().decode(bytes)).toBe("cerberus");
  });
});
