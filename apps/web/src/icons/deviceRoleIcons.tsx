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

export function DeviceRoleIconGlyph({ kind, testId }: DeviceRoleIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-testid={testId}
      data-icon-kind={kind}
    >
      {kind === "router" ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 4v2M12 18v2M4 12h2M18 12h2" />
        </>
      ) : null}
      {kind === "switch" ? (
        <>
          <rect x="4" y="8" width="16" height="8" rx="2" />
          <circle cx="9" cy="12" r="1" />
          <circle cx="15" cy="12" r="1" />
        </>
      ) : null}
      {kind === "firewall" ? (
        <>
          <rect x="4" y="7" width="16" height="10" rx="1.5" />
          <path d="M4 12h16M9 7v10M15 7v10" />
        </>
      ) : null}
      {kind === "cloud" ? (
        <path d="M7 18h10a4 4 0 0 0 .4-8A6 6 0 0 0 6.2 8.6 4.5 4.5 0 0 0 7 18Z" />
      ) : null}
      {kind === "host" ? (
        <>
          <rect x="5" y="6" width="14" height="10" rx="2" />
          <path d="M9 19h6m-8 0h10" />
        </>
      ) : null}
      {kind === "client" ? (
        <>
          <circle cx="12" cy="9" r="3" />
          <path d="M6.5 18a5.5 5.5 0 0 1 11 0" />
        </>
      ) : null}
    </svg>
  );
}

export function getDeviceRoleIcon(role?: DeviceRoleIcon, testId?: string) {
  if (!role) {
    return null;
  }

  return (
    <DeviceRoleIconGlyph
      kind={role}
      testId={testId ?? `device-role-icon-${role}`}
    />
  );
}
