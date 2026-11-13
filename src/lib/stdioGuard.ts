// The host can close stderr while the server runs (seen under OpenCode). A log line
// then fails with EPIPE, and an unhandled stream "error" ends the process with
// every YAAIF tool. Lost logs are fine; a closed stdout means the client is
// gone, so leave quietly.
export function guardStdioPipes(stdout: NodeJS.WriteStream = process.stdout, stderr: NodeJS.WriteStream = process.stderr, exit: (code: number) => void = process.exit): void {
  stderr.on("error", () => {});
  stdout.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") exit(0);
  });
}
