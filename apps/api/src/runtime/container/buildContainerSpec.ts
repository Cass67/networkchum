export function buildContainerSpec(input: {
  nodeName: string;
  image: string;
  cpu: number;
  memoryMb: number;
  network?: string;
}) {
  const command = [
    "docker",
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

  command.push(input.image, "sleep", "infinity");

  return {
    runtime: "container" as const,
    command,
  };
}
