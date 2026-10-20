const roleIconOptions = [
  "router",
  "switch",
  "firewall",
  "cloud",
  "host",
  "client",
] as const;

export type DeviceRoleIcon = (typeof roleIconOptions)[number];

type DeviceRoleIconProps = {
  kind: DeviceRoleIcon;
  testId?: string;
};

// Shared paint for the Visio stencil glyphs. Mounted once (from App) because
// CSS `url(#...)` fills in theme.css resolve against these ids document-wide.
export function DeviceGlyphGradientDefs() {
  return (
    <svg
      width="0"
      height="0"
      style={{ position: "absolute" }}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="nc-glyph-router" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7dcdf7" />
          <stop offset="1" stopColor="#1a6bb0" />
        </linearGradient>
        <linearGradient id="nc-glyph-switch-top" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e8f4fd" />
          <stop offset="1" stopColor="#b0d8f0" />
        </linearGradient>
        <linearGradient id="nc-glyph-switch-front" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3f8fcf" />
          <stop offset="1" stopColor="#1c5f9c" />
        </linearGradient>
        <linearGradient id="nc-glyph-switch-side" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#14496f" />
          <stop offset="1" stopColor="#0c3552" />
        </linearGradient>
        <linearGradient id="nc-glyph-firewall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d2694f" />
          <stop offset="1" stopColor="#a5432f" />
        </linearGradient>
        <linearGradient id="nc-glyph-cloud" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#cfe8fa" />
        </linearGradient>
        <linearGradient id="nc-glyph-host" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f0f4f8" />
          <stop offset="1" stopColor="#b8c6d4" />
        </linearGradient>
        <linearGradient id="nc-glyph-client" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#dce9f4" />
          <stop offset="1" stopColor="#9db8cf" />
        </linearGradient>
        <linearGradient id="nc-glyph-container-top" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e0f5f2" />
          <stop offset="1" stopColor="#b7e0da" />
        </linearGradient>
        <linearGradient
          id="nc-glyph-container-front"
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop offset="0" stopColor="#58b5a8" />
          <stop offset="1" stopColor="#2f8577" />
        </linearGradient>
        <linearGradient
          id="nc-glyph-container-side"
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop offset="0" stopColor="#1f5f56" />
          <stop offset="1" stopColor="#164740" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// Stencil shapes on a 24x24 grid; paint (fills, strokes, glow) comes from
// theme.css keyed on `data-icon-kind`, so the Visio default and the neon
// theme are pure CSS over the same markup.
export function DeviceRoleIconGlyph({ kind, testId }: DeviceRoleIconProps) {
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
      {kind === "router" ? (
        <>
          <circle className="glyph-body" cx="12" cy="12" r="7.5" />
          <path
            className="glyph-detail"
            d="M5.625 12h4.875M8.25 10.125L6 12l2.25 1.875M13.5 12h4.875M15.75 10.125L18 12l-2.25 1.875M12 5.625v4.875M10.125 8.25L12 6l2.25 2.25M12 13.5v4.875M10.125 15.75L12 18l2.25-2.25"
          />
        </>
      ) : null}
      {kind === "switch" ? (
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
            d="M5.75 11.25l-1.5 1.5 1.5 1.5M5.75 12.75h4M10.25 12.75h4M14.25 11.25l1.5 1.5-1.5 1.5"
          />
        </>
      ) : null}
      {kind === "firewall" ? (
        <>
          <rect
            className="glyph-body"
            x="4.5"
            y="6"
            width="15"
            height="12"
            rx="0.75"
          />
          <path
            className="glyph-detail"
            d="M4.5 9h15M4.5 12h15M4.5 15h15M8.25 6v3M12.75 6v3M6 9v3M10.5 9v3M15 9v3M8.25 12v3M12.75 12v3M6 15v3M10.5 15v3M15 15v3"
          />
        </>
      ) : null}
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
      {kind === "host" ? (
        <>
          <rect
            className="glyph-body"
            x="5.25"
            y="4.5"
            width="13.5"
            height="15"
            rx="1.125"
          />
          <path
            className="glyph-detail"
            d="M5.25 9h13.5M5.25 13.5h13.5M7.5 6.75h3.75M7.5 11.25h3.75M7.5 15.75h3.75"
          />
          <path
            className="glyph-led"
            d="M16.5 6.75h0.2M16.5 11.25h0.2M16.5 15.75h0.2"
          />
        </>
      ) : null}
      {kind === "client" ? (
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

function isDeviceRoleIcon(value?: string): value is DeviceRoleIcon {
  if (!value) {
    return false;
  }

  return roleIconOptions.includes(value as DeviceRoleIcon);
}

export function getDeviceRoleIcon(role?: string, testId?: string) {
  if (!isDeviceRoleIcon(role)) {
    return null;
  }

  return (
    <DeviceRoleIconGlyph
      kind={role}
      testId={testId ?? `device-role-icon-${role}`}
    />
  );
}
