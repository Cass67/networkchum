const API_PORT = 4000;
const BRIDGE_PORT = 4010;

type BrowserLocationLike = {
  protocol: string;
  hostname: string;
};

export function isLocalPageHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost";
}

function normalizePageHost(hostname: string): string {
  if (!hostname || isLocalPageHost(hostname)) {
    return "127.0.0.1";
  }

  return hostname;
}

function resolveHttpProtocol(protocol: string): string {
  return protocol === "https:" ? "https:" : "http:";
}

function resolveWsProtocol(protocol: string): string {
  return protocol === "https:" ? "wss:" : "ws:";
}

export function resolveApiBaseUrl(locationLike: BrowserLocationLike): string {
  return `${resolveHttpProtocol(locationLike.protocol)}//${normalizePageHost(locationLike.hostname)}:${API_PORT}`;
}

export function resolveBridgeBaseUrl(
  _locationLike: BrowserLocationLike,
): string {
  return `http://127.0.0.1:${BRIDGE_PORT}`;
}

export function resolveConsoleWebSocketUrl(
  locationLike: BrowserLocationLike,
  labId: string,
  nodeId: string,
): string {
  return `${resolveWsProtocol(locationLike.protocol)}//${normalizePageHost(locationLike.hostname)}:${API_PORT}/labs/${labId}/nodes/${nodeId}/console`;
}

export function resolveVncWebSocketUrl(
  locationLike: BrowserLocationLike,
  labId: string,
  nodeId: string,
): string {
  return `${resolveWsProtocol(locationLike.protocol)}//${normalizePageHost(locationLike.hostname)}:${API_PORT}/labs/${labId}/nodes/${nodeId}/vnc`;
}
