const mockCanvasContext = {
  direction: "ltr",
  fillStyle: "",
  font: "",
  globalAlpha: 1,
  globalCompositeOperation: "source-over",
  imageSmoothingEnabled: true,
  measureText: () => ({ width: 0 }),
  setTransform: () => {},
  clearRect: () => {},
  fillRect: () => {},
  beginPath: () => {},
  moveTo: () => {},
  lineTo: () => {},
  closePath: () => {},
  stroke: () => {},
  createLinearGradient: () =>
    ({
      addColorStop: () => {},
    }) as unknown as CanvasGradient,
} as unknown as CanvasRenderingContext2D;

HTMLCanvasElement.prototype.getContext = (() =>
  mockCanvasContext) as unknown as typeof HTMLCanvasElement.prototype.getContext;

if (!SVGSVGElement.prototype.createSVGPoint) {
  SVGSVGElement.prototype.createSVGPoint = function () {
    return {
      x: 0,
      y: 0,
      z: 0,
      w: 1,
      matrixTransform: () =>
        ({
          x: 0,
          y: 0,
          z: 0,
          w: 1,
          toJSON: () => ({}),
        }) as DOMPoint,
      toJSON: () => ({}),
    } as DOMPoint;
  } as typeof SVGSVGElement.prototype.createSVGPoint;
}

if (!SVGSVGElement.prototype.getScreenCTM) {
  SVGSVGElement.prototype.getScreenCTM = function () {
    return {
      inverse: () => ({
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        e: 0,
        f: 0,
      }),
    } as DOMMatrix;
  } as typeof SVGSVGElement.prototype.getScreenCTM;
}
