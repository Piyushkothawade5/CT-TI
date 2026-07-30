declare module "pako" {
  export type DeflateOptions = {
    level?: number;
    memLevel?: number;
    strategy?: number;
  };

  export function deflate(data: Uint8Array, options?: DeflateOptions): Uint8Array;
}
