// wawoff2 ships no types.
declare module "wawoff2" {
  const woff2: { decompress(data: Uint8Array): Promise<Uint8Array>; compress(data: Uint8Array): Promise<Uint8Array> };
  export default woff2;
}
