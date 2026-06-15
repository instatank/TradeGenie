import { readScreenshotFile } from "@/lib/screenshot-storage";
import { db } from "@/lib/data";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const screenshot = await db.get("screenshots", id);
  if (!screenshot) return new Response("Screenshot not found", { status: 404 });

  try {
    const { bytes, contentType } = await readScreenshotFile(screenshot.filePath);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return new Response("Screenshot file unavailable", { status: 404 });
  }
}
