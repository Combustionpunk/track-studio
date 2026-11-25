// apps/web/guide-images.ts: the size of each screenshot in docs/guide/img, by file name
declare module "virtual:guide-image-sizes" {
  const sizes: Record<string, { width: number; height: number }>;
  export default sizes;
}
