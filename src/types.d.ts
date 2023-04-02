declare const DEV: boolean;

declare module "*.json" {
  const path: string;
  export default path;
}

declare module "*.wasm" {
  const path: string;
  export default path;
}
