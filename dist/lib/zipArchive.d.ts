export type ZipEntry = {
    name: string;
    data: Buffer;
    date?: Date;
};
/** Build a ZIP archive (deflate) with UTF-8 names. Paths should use `/`. */
export declare function buildZip(entries: ZipEntry[]): Buffer;
