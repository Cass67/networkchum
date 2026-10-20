type DeviceIconKind = "cloud" | "container" | "vm";

type DeviceIconProps = {
  kind: DeviceIconKind;
  testId?: string;
};

export function getDeviceIconKind(runtime?: string): DeviceIconKind {
  if (runtime === "cloud") {
    return "cloud";
  }

  if (runtime === "container") {
    return "container";
  }

  return "vm";
}

// Runtime-kind fallback for nodes without a template role. Uses the same
// stencil markup contract as DeviceRoleIconGlyph (24x24 grid, paint from
// theme.css keyed on data-icon-kind) so both themes cover every glyph.
export function DeviceIcon({ kind, testId }: DeviceIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      className="device-role-glyph"
      aria-hidden="true"
      data-testid={testId}
      data-icon-kind={kind}
    >
      {kind === "cloud" ? (
        <>
          <path
            className="glyph-body"
            d="M7.5 18h9a3 3 0 0 0 .6-5.925A4.5 4.5 0 0 0 8.25 10.275 3.75 3.75 0 0 0 7.5 18Z"
          />
          <path
            className="glyph-detail"
            d="M9 16.5h6.38a2.44 2.44 0 0 0 .37-4.84"
          />
        </>
      ) : null}
      {kind === "container" ? (
        <>
          <path className="glyph-top" d="M3.75 9.75L6 6.5h12.75L16.5 9.75Z" />
          <path className="glyph-side" d="M16.5 9.75L18.75 6.5v8.25L16.5 18Z" />
          <rect
            className="glyph-front"
            x="3.75"
            y="9.75"
            width="12.75"
            height="8.25"
          />
          <path
            className="glyph-detail"
            d="M7.125 9.75v8.25M10.5 9.75v8.25M13.875 9.75v8.25"
          />
        </>
      ) : null}
      {kind === "vm" ? (
        <>
          <rect
            className="glyph-body"
            x="4.5"
            y="4.5"
            width="15"
            height="9.75"
            rx="1.125"
          />
          <rect className="glyph-screen" x="6" y="6" width="12" height="6.75" />
          <path
            className="glyph-detail"
            d="M9.75 14.25l-.75 2.25h6l-.75-2.25M7.5 16.5h9"
          />
        </>
      ) : null}
    </svg>
  );
}
