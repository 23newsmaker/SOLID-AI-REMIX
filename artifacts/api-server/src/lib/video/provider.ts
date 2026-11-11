// Deliberately no external endpoint, account or SDK is configured.
export type VideoCapabilities = {
  id: string; approved: boolean; imageToVideo: boolean; extraImages: boolean;
  referenceVideo: boolean; durations: number[]; aspectRatios: string[];
};
export interface VideoProviderAdapter {
  capabilities: VideoCapabilities;
  submit(input: { requestKey: string; publicVisualPrompt: string }): Promise<{ providerJobId: string; simulated: boolean }>;
  status(providerJobId: string): Promise<"SIMULATED" | "PROCESSING" | "COMPLETED" | "FAILED" | "UNKNOWN">;
  result(providerJobId: string): Promise<{ url: string } | null>;
  cost(providerJobId: string): Promise<number | null>;
  retryAllowed(status: string): boolean;
}
export const mockVideoProvider: VideoProviderAdapter = {
  capabilities: { id: "mock-unapproved", approved: false, imageToVideo: false, extraImages: false, referenceVideo: false, durations: [], aspectRatios: [] },
  async submit(input) { return { providerJobId: `simulated-${input.requestKey}`, simulated: true }; },
  async status() { return "SIMULATED"; },
  async result() { return null; },
  async cost() { return null; },
  retryAllowed() { return false; },
};
export function assertProviderCapabilities(cap: VideoCapabilities, input: { duration: number; ratio: string; images: number; videos: number }) {
  if (!cap.approved || !cap.imageToVideo) throw new Error("Provider AI belum disetujui; tidak ada foto dikirim.");
  if (!cap.durations.includes(input.duration) || !cap.aspectRatios.includes(input.ratio) ||
    (input.images > 0 && !cap.extraImages) || (input.videos > 0 && !cap.referenceVideo)) {
    throw new Error("Bahan, durasi atau rasio tidak didukung provider; pekerjaan tidak dikirim.");
  }
}
