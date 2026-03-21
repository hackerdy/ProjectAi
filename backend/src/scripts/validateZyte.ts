import "dotenv/config";

function getZyteApiKey(): string {
  return (process.env.ZYTE_API_KEY ?? "").trim().replace(/^['\"]|['\"]$/g, "");
}

async function main(): Promise<void> {
  const key = getZyteApiKey();
  if (!key) {
    console.error("ZYTE_API_KEY is not set in backend/.env");
    process.exitCode = 1;
    return;
  }

  const auth = `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
  const response = await fetch("https://api.zyte.com/v1/extract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: auth,
    },
    body: JSON.stringify({
      url: "https://example.com",
      article: true,
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    console.error(`Zyte check failed (${response.status})`);
    console.error(body);
    process.exitCode = 1;
    return;
  }

  console.log("Zyte check passed. Credentials are valid.");
}

main().catch((error) => {
  console.error("Zyte check failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
