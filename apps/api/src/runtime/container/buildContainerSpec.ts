export function buildContainerSpec(input: {
  engine?: "docker" | "podman";
  nodeName: string;
  image: string;
  cpu: number;
  memoryMb: number;
  network?: string;
  shell?: string;
}) {
  const command = [
    input.engine ?? "docker",
    "run",
    "-d",
    "--name",
    input.nodeName,
    "--cpus",
    String(input.cpu),
    "--memory",
    `${input.memoryMb}m`,
  ];

  if (input.network) {
    command.push("--network", input.network);
  }

  command.push(input.image, input.shell ?? "sh", "-lc", "sleep infinity");

  return {
    runtime: "container" as const,
    command,
  };
}
