// The read-only viewer role rides on the same one-cookie gate the owner
// password already used (lib/site-auth.ts). The property that actually
// matters — a cookie's value alone tells you the role, with no separate
// "role" field that could drift out of sync with it — is pure crypto and
// worth pinning directly, since middleware.ts trusts roleForToken() for
// every request in the app.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

const OWNER_PASSWORD = "owner-secret";
const VIEWER_PASSWORD = "viewer-secret";

describe("site-auth roles", () => {
  let originalSite: string | undefined;
  let originalViewer: string | undefined;

  beforeEach(() => {
    originalSite = process.env.SITE_PASSWORD;
    originalViewer = process.env.VIEWER_PASSWORD;
    process.env.SITE_PASSWORD = OWNER_PASSWORD;
    process.env.VIEWER_PASSWORD = VIEWER_PASSWORD;
  });

  afterEach(() => {
    if (originalSite === undefined) delete process.env.SITE_PASSWORD;
    else process.env.SITE_PASSWORD = originalSite;
    if (originalViewer === undefined) delete process.env.VIEWER_PASSWORD;
    else process.env.VIEWER_PASSWORD = originalViewer;
  });

  it("authenticates the owner and viewer passwords as different roles", async () => {
    const { authenticate } = await import("@/lib/site-auth");
    const owner = await authenticate(OWNER_PASSWORD);
    const viewer = await authenticate(VIEWER_PASSWORD);
    assert.equal(owner?.role, "owner");
    assert.equal(viewer?.role, "viewer");
    assert.notEqual(owner?.token, viewer?.token, "owner and viewer tokens must never collide");
  });

  it("rejects a wrong password entirely", async () => {
    const { authenticate } = await import("@/lib/site-auth");
    assert.equal(await authenticate("not-a-real-password"), null);
    assert.equal(await authenticate(""), null);
  });

  it("roleForToken recovers the same role a token was issued for", async () => {
    const { authenticate, roleForToken } = await import("@/lib/site-auth");
    const owner = await authenticate(OWNER_PASSWORD);
    const viewer = await authenticate(VIEWER_PASSWORD);
    assert.equal(await roleForToken(owner!.token), "owner");
    assert.equal(await roleForToken(viewer!.token), "viewer");
    assert.equal(await roleForToken("some-forged-value"), null);
    assert.equal(await roleForToken(undefined), null);
  });

  it("has no viewer role at all when VIEWER_PASSWORD is unset", async () => {
    delete process.env.VIEWER_PASSWORD;
    const { authenticate, viewerAuthConfigured } = await import("@/lib/site-auth");
    assert.equal(viewerAuthConfigured(), false);
    assert.equal(await authenticate(VIEWER_PASSWORD), null);
  });

  it("the owner token format is unchanged by adding the viewer role", async () => {
    // Regression guard: roleTag("owner") must stay "" so this change never
    // signs an already-logged-in owner out.
    const { checkPassword } = await import("@/lib/site-auth");
    const crypto = await import("node:crypto");
    const expected = crypto.createHash("sha256").update(`tradegenie-site-gate:${OWNER_PASSWORD}`).digest("hex");
    assert.equal(await checkPassword(OWNER_PASSWORD), expected);
  });
});
