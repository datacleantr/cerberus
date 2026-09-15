import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseBody, storeCreateSchema } from "./validation";

const schema = z.object({ name: z.string() });

function request(body: BodyInit | null, contentType = "application/json") {
  return new Request("https://example.test/api", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
}

describe("parseBody", () => {
  it("geçerli JSON'u doğrular", async () => {
    const result = await parseBody(request(JSON.stringify({ name: "Cerberus" })), schema);
    expect("data" in result && result.data.name).toBe("Cerberus");
  });

  it("JSON content type zorunludur", async () => {
    const result = await parseBody(request('{"name":"x"}', "text/plain"), schema);
    expect("response" in result && result.response.status).toBe(415);
  });

  it("Content-Length olmasa da gerçek akış boyutunu sınırlar", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"name":"'));
        controller.enqueue(new TextEncoder().encode("x".repeat(100)));
        controller.enqueue(new TextEncoder().encode('"}'));
        controller.close();
      },
    });
    const req = new Request("https://example.test/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      // Node's Request requires duplex for a streaming request body.
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const result = await parseBody(req, schema, 32);
    expect("response" in result && result.response.status).toBe(413);
  });

  it("bozuk JSON için 400 döner", async () => {
    const result = await parseBody(request("{"), schema);
    expect("response" in result && result.response.status).toBe(400);
  });
});

describe("storeCreateSchema", () => {
  const base = { storeCode: "ANK", storeName: "Ankara Store" };

  it("kart bilinmiyorsa boş bırakılmasına izin verir", () => {
    expect(storeCreateSchema.parse({ ...base, defaultCard: "" }).defaultCard).toBe("");
  });

  it("kart alanında yalnız dört hane kabul eder", () => {
    expect(storeCreateSchema.safeParse({ ...base, defaultCard: "1234" }).success).toBe(true);
    expect(storeCreateSchema.safeParse({ ...base, defaultCard: "1753xxxx" }).success).toBe(false);
  });

  it("mağaza e-postasının biçimini doğrular", () => {
    expect(storeCreateSchema.safeParse({ ...base, defaultEmail: "not-an-email" }).success).toBe(false);
  });
});
