export type InstallRollbackAction = () => Promise<void>;
export type FileBackup = {
    path: string;
    contents: Buffer | null;
};
export declare function captureFileBackup(path: string): Promise<FileBackup>;
export declare function restoreFileBackup(backup: FileBackup): Promise<void>;
export declare function restoreStagedPlugin(staging: string, dest: string): Promise<void>;
export declare function restoreIntellijPlugin(pluginsDir: string): Promise<void>;
export declare function runInstallRollback(actions: InstallRollbackAction[], failure: unknown): Promise<void>;
