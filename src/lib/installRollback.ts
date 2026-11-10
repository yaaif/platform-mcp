import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export type InstallRollbackAction = () => Promise<void>;

export type FileBackup = {
  path: string;
  contents: Buffer | null;
};

export async function captureFileBackup(path: string): Promise<FileBackup> {
  try {
    return { path, contents: await readFile(path) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path, contents: null };
    throw error;
  }
}

export async function restoreFileBackup(backup: FileBackup): Promise<void> {
  if (backup.contents === null) {
    await rm(backup.path, { force: true });
    return;
  }
  await mkdir(dirname(backup.path), { recursive: true });
  const temporary = `${backup.path}.rollback`;
  await writeFile(temporary, backup.contents, { mode: 0o600 });
  await rename(temporary, backup.path);
}

export async function restoreStagedPlugin(staging: string, dest: string): Promise<void> {
  const old = `${dest}.__old`;
  if (existsSync(old)) {
    await rm(dest, { recursive: true, force: true });
    await rename(old, dest);
  } else {
    await rm(dest, { recursive: true, force: true });
  }
  await rm(staging, { recursive: true, force: true });
}

export async function restoreIntellijPlugin(pluginsDir: string): Promise<void> {
  const destination = join(pluginsDir, "yaaif-jetbrains.jar");
  const backup = join(pluginsDir, "yaaif-jetbrains.jar.backup");
  await rm(join(pluginsDir, "yaaif-jetbrains.jar.tmp"), { force: true });
  if (existsSync(backup)) {
    const temporary = join(pluginsDir, "yaaif-jetbrains.jar.rollback");
    await copyFile(backup, temporary);
    await rename(temporary, destination);
  } else {
    await rm(destination, { force: true });
  }
}

export async function runInstallRollback(actions: InstallRollbackAction[], failure: unknown): Promise<void> {
  const errors: unknown[] = [];
  for (const action of [...actions].reverse()) {
    try {
      await action();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) {
    console.error(`install: rollback after ${String(failure)} had errors: ${errors.map(String).join("; ")}`);
  }
}
