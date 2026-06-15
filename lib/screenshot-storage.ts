import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { firebaseStorageBucket, usesFirebase } from "@/lib/store";

export async function saveScreenshotFile(file: File, tradeId: string) {
  const bytes = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-") || "screenshot";
  const fileName = `${Date.now()}-${safeName}`;

  if (usesFirebase()) {
    const bucket = firebaseStorageBucket();
    const objectPath = `screenshots/trades/${tradeId}/${fileName}`;
    await bucket.file(objectPath).save(bytes, {
      metadata: {
        contentType: file.type || contentTypeFromName(file.name),
        metadata: {
          originalName: file.name,
          tradeId,
        },
      },
      resumable: false,
    });
    return `firebase://${bucket.name}/${objectPath}`;
  }

  const localFileName = `${tradeId}-${fileName}`;
  const uploadDir = path.join(process.cwd(), "public", "uploads");
  await mkdir(uploadDir, { recursive: true });
  await writeFile(path.join(uploadDir, localFileName), bytes);
  return `/uploads/${localFileName}`;
}

export async function readScreenshotFile(filePath: string) {
  if (filePath.startsWith("firebase://")) return readFirebaseScreenshot(filePath);
  return readLocalScreenshot(filePath);
}

async function readFirebaseScreenshot(filePath: string) {
  const { bucketName, objectPath } = parseFirebasePath(filePath);
  const bucket = firebaseStorageBucket(bucketName);
  const file = bucket.file(objectPath);
  const [metadata] = await file.getMetadata();
  const [bytes] = await file.download();
  return {
    bytes,
    contentType: String(metadata.contentType ?? contentTypeFromName(objectPath)),
  };
}

async function readLocalScreenshot(filePath: string) {
  const localName = filePath.replace(/^\/uploads\//, "");
  if (!localName || localName.includes("..") || path.isAbsolute(localName)) {
    throw new Error("Invalid local screenshot path");
  }
  const bytes = await readFile(path.join(process.cwd(), "public", "uploads", localName));
  return {
    bytes,
    contentType: contentTypeFromName(localName),
  };
}

function parseFirebasePath(filePath: string) {
  const withoutScheme = filePath.replace(/^firebase:\/\//, "");
  const slashIndex = withoutScheme.indexOf("/");
  if (slashIndex < 1) throw new Error("Invalid Firebase screenshot path");
  return {
    bucketName: withoutScheme.slice(0, slashIndex),
    objectPath: withoutScheme.slice(slashIndex + 1),
  };
}

function contentTypeFromName(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}
