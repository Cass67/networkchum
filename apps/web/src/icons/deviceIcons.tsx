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

export function DeviceIcon({ kind, testId }: DeviceIconProps) {
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
      {kind === "cloud" ? (
        <path d="M7 18h10a4 4 0 0 0 .4-8A6 6 0 0 0 6.2 8.6 4.5 4.5 0 0 0 7 18Z" />
      ) : null}
      {kind === "container" ? (
        <>
          <rect x="4" y="7" width="16" height="10" rx="2" />
          <path d="M9 7V5m6 2V5M8 12h8" />
        </>
      ) : null}
      {kind === "vm" ? (
        <>
          <rect x="4" y="5" width="16" height="11" rx="2" />
          <path d="M9 19h6m-8 0h10" />
        </>
      ) : null}
    </svg>
  );
}
