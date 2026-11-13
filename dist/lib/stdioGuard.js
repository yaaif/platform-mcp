// The host can close stderr while the server runs (seen under OpenCode). A log line
// then fails with EPIPE, and an unhandled stream "error" ends the process with
// every YAAIF tool. Lost logs are fine; a closed stdout means the client is
// gone, so leave quietly.
export function guardStdioPipes(stdout = process.stdout, stderr = process.stderr, exit = process.exit) {
    stderr.on("error", () => { });
    stdout.on("error", (err) => {
        if (err.code === "EPIPE")
            exit(0);
    });
}
