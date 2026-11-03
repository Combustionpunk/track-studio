// Just enough S3 for the backups (DigitalOcean Spaces, or any S3-compatible store): signed PUT, GET, DELETE and
// ListObjectsV2, path-style (<endpoint>/<bucket>/<key>). No SDK: the backup runs in the server image with no extra deps.
import { createHash, createHmac } from "node:crypto";

export const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");

export interface S3Settings {
  /** e.g. https://ams3.digitaloceanspaces.com */
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

/** RFC 3986 encoding as S3 wants it: everything but A-Z a-z 0-9 - . _ ~ */
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const hmac = (key: string | Buffer, s: string) => createHmac("sha256", key).update(s).digest();

/**
 * AWS Signature Version 4 for one request. `headers` are the extra headers to sign (lower-case names); `host`,
 * `x-amz-date` and `x-amz-content-sha256` are added. Returns the headers to send, including `authorization`.
 */
export function signRequest(r: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  payloadHash: string;
  accessKey: string;
  secretKey: string;
  region: string;
  now: Date;
}): Record<string, string> {
  const amzDate = r.now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = { ...r.headers, "x-amz-date": amzDate, "x-amz-content-sha256": r.payloadHash };
  const signing: Record<string, string> = { ...headers, host: r.url.host };
  const names = Object.keys(signing).map((n) => n.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(signing).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, " ")]));
  const path = r.url.pathname.split("/").map((seg) => enc(decodeURIComponent(seg))).join("/");
  const query = [...r.url.searchParams].map(([k, v]) => [enc(k), enc(v)]).sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("&");
  const canonical = [r.method, path, query, names.map((n) => `${n}:${lower[n]}\n`).join(""), names.join(";"), r.payloadHash].join("\n");
  const scope = `${day}/${r.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${r.secretKey}`, day), r.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${r.accessKey}/${scope},SignedHeaders=${names.join(";")},Signature=${signature}` };
}

const unxml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

export class S3Client {
  constructor(
    private s: S3Settings,
    private fetchFn: typeof fetch = fetch,
  ) {}

  private async send(method: string, key: string, query: Record<string, string> = {}, body?: Buffer): Promise<Buffer> {
    const url = new URL(`${this.s.endpoint.replace(/\/+$/, "")}/${enc(this.s.bucket)}/${key.split("/").map(enc).join("/")}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const headers = signRequest({ method, url, headers: {}, payloadHash: body ? sha256(body) : EMPTY_SHA256, accessKey: this.s.accessKey, secretKey: this.s.secretKey, region: this.s.region, now: new Date() });
    const res = await this.fetchFn(url, { method, headers, body: body ? new Uint8Array(body) : undefined });
    const data = Buffer.from(await res.arrayBuffer());
    if (!res.ok) {
      const code = /<Code>([^<]*)<\/Code>/.exec(data.toString("utf8"))?.[1];
      throw new Error(`Spaces ${method} ${key || "(list)"}: HTTP ${res.status}${code ? ` ${code}` : ""}`);
    }
    return data;
  }

  async put(key: string, body: Buffer): Promise<void> {
    await this.send("PUT", key, {}, body);
  }

  get(key: string): Promise<Buffer> {
    return this.send("GET", key);
  }

  async delete(key: string): Promise<void> {
    await this.send("DELETE", key);
  }

  /** Every key under `prefix`, following continuation tokens. */
  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const xml = (await this.send("GET", "", { "list-type": "2", prefix, ...(token ? { "continuation-token": token } : {}) })).toString("utf8");
      for (const m of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(unxml(m[1]));
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? unxml(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] ?? "") || undefined : undefined;
    } while (token);
    return keys;
  }
}
