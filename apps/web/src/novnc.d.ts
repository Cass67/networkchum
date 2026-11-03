declare module "@novnc/novnc" {
  export default class RFB {
    constructor(
      target: HTMLElement,
      url: string,
      options?: Record<string, unknown>,
    );
    scaleViewport: boolean;
    resizeSession: boolean;
    viewOnly: boolean;
    disconnect(): void;
    addEventListener(
      type: string,
      listener: (event: CustomEvent<{ clean?: boolean }>) => void,
    ): void;
    removeEventListener(
      type: string,
      listener: (event: CustomEvent<{ clean?: boolean }>) => void,
    ): void;
  }
}
