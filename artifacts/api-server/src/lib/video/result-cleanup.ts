export const CLEANUP_PENDING = "[STORAGE_CLEANUP_PENDING]";
export function previousVideoError(error: string | null) {
  return error?.split(CLEANUP_PENDING)[0]?.trim() || null;
}
export function videoResultPaths(job: { id: string; resultPath: string | null; rawResultPath: string | null }) {
  return [...new Set([job.resultPath, job.rawResultPath, `/objects/videos/${job.id}-final.mp4`]
    .filter((path): path is string => !!path))];
}
export async function cleanVideoObjects(job: Parameters<typeof videoResultPaths>[0], remove: (path: string) => Promise<unknown>) {
  const results = await Promise.allSettled(videoResultPaths(job).map(path => remove(path)));
  return results.every(result => result.status === "fulfilled");
}
