// A tiny in-memory S3 (path-style: /bucket/key) for the backup tests: PUT, GET, DELETE and ListObjectsV2.
// It checks every request is signed for the right credentials, by re-signing it with the client's own signer.
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { signRequest } from "../src/s3.js";

export interface StubRequest {
  method: string;
  path: string;
}

export async function startS3Stub(opts: { bucket: string; accessKey: string; secretKey: string; region: string }) {
  const objects = new Map<string, Buffer>();
  const requests: StubRequest[] = [];
  const body = (req: IncomingMessage) =>
    new Promise<Buffer>((ok, fail) => {
      const parts: Buffer[] = [];
      req.on("data", (c: Buffer) => parts.push(c)).on("end", () => ok(Buffer.concat(parts))).on("error", fail);
    });
  const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    requests.push({ method: req.method!, path: url.pathname });
    const data = await body(req);
    const amzDate = String(req.headers["x-amz-date"] ?? "");
    const now = new Date(amzDate.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, "$1-$2-$3T$4:$5:$6Z"));
    const signed = Object.fromEntries(
      String(req.headers.authorization ?? "")
        .replace(/^.*SignedHeaders=([^,]+).*$/, "$1")
        .split(";")
        .filter((h) => h !== "host")
        .map((h) => [h, String(req.headers[h])]),
    );
    const expected = signRequest({ method: req.method!, url, headers: signed, payloadHash: String(req.headers["x-amz-content-sha256"]), accessKey: opts.accessKey, secretKey: opts.secretKey, region: opts.region, now });
    if (Number.isNaN(now.getTime()) || req.headers.authorization !== expected.authorization) {
      res.writeHead(403).end("<Error><Code>SignatureDoesNotMatch</Code></Error>");
      return;
    }
    const [, bucket, ...rest] = url.pathname.split("/");
    const key = rest.map(decodeURIComponent).join("/");
    if (bucket !== opts.bucket) return void res.writeHead(404).end("<Error><Code>NoSuchBucket</Code></Error>");
    if (req.method === "GET" && !key && url.searchParams.get("list-type") === "2") {
      const prefix = url.searchParams.get("prefix") ?? "";
      const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = Number(url.searchParams.get("continuation-token") ?? 0);
      const page = all.slice(start, start + 5); // small pages so pagination is exercised
      const more = start + 5 < all.length;
      res.writeHead(200, { "content-type": "application/xml" }).end(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><IsTruncated>${more}</IsTruncated>` +
          page.map((k) => `<Contents><Key>${xml(k)}</Key><Size>${objects.get(k)!.length}</Size></Contents>`).join("") +
          (more ? `<NextContinuationToken>${start + 5}</NextContinuationToken>` : "") +
          `</ListBucketResult>`,
      );
    } else if (req.method === "PUT" && key) {
      objects.set(key, data);
      res.writeHead(200).end();
    } else if (req.method === "GET" && key) {
      const o = objects.get(key);
      if (o) res.writeHead(200).end(o);
      else res.writeHead(404).end("<Error><Code>NoSuchKey</Code></Error>");
    } else if (req.method === "DELETE" && key) {
      objects.delete(key);
      res.writeHead(204).end();
    } else res.writeHead(400).end();
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${port}`,
    objects,
    requests,
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}
