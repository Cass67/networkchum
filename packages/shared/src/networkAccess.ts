export type BindMode = "localhost" | "lan";

export function resolveBindMode(value: string | undefined): BindMode {
  return value === "lan" ? "lan" : "localhost";
}

export function resolveListenHost(value: string | undefined): string {
  return resolveBindMode(value) === "lan" ? "0.0.0.0" : "127.0.0.1";
}
