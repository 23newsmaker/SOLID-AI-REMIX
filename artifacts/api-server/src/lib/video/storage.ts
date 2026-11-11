import { objectStorageClient, ObjectStorageService } from "../objectStorage";
import { CreativeError } from "../creative-policy";
export const videoStorage = new ObjectStorageService();
export function videoFile(objectPath: string) {
  if (!/^\/objects\/videos\/[a-zA-Z0-9._-]+$/.test(objectPath)) throw new CreativeError(400, "Lokasi video tidak valid.");
  const full = `${videoStorage.getPrivateObjectDir()}/${objectPath.slice(9)}`.replace(/^\/+/, "");
  const [bucket, ...parts] = full.split("/");
  return objectStorageClient.bucket(bucket!).file(parts.join("/"));
}
