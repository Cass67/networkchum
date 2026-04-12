export type RunningConfigBackupAdapter = {
  supports: (labId: string, nodeId: string) => Promise<boolean> | boolean;
  capture: (labId: string, nodeId: string) => Promise<string>;
};

export async function findSupportingAdapter(
  adapters: RunningConfigBackupAdapter[],
  labId: string,
  nodeId: string,
): Promise<RunningConfigBackupAdapter | undefined> {
  for (const adapter of adapters) {
    const supported = await adapter.supports(labId, nodeId);
    if (supported) {
      return adapter;
    }
  }

  return undefined;
}
