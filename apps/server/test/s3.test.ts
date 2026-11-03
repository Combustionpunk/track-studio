import { describe, expect, it } from "vitest";
import { EMPTY_SHA256, signRequest } from "../src/s3.js";

// The worked examples in the AWS docs, "Signature Calculations for the Authorization Header" (Amazon S3, SigV4).
const AWS = {
  accessKey: "AKIAIOSFODNN7EXAMPLE",
  secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
  now: new Date("2013-05-24T00:00:00Z"),
};

describe("S3 request signing (SigV4)", () => {
  it("matches AWS's GET Object example", () => {
    const h = signRequest({ ...AWS, method: "GET", url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"), headers: { range: "bytes=0-9" }, payloadHash: EMPTY_SHA256 });
    expect(h.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
    expect(h["x-amz-date"]).toBe("20130524T000000Z");
    expect(h["x-amz-content-sha256"]).toBe(EMPTY_SHA256);
  });

  it("matches AWS's GET Bucket (list objects) example, with a query string", () => {
    const h = signRequest({ ...AWS, method: "GET", url: new URL("https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J"), headers: {}, payloadHash: EMPTY_SHA256 });
    expect(h.authorization).toMatch(/Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7$/);
  });
});
