const contactEmail = "shen@shenren.org";

const securityHeaders = {
  "content-security-policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), geolocation=(), microphone=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

type TrustPage = {
  readonly title: string;
  readonly description: string;
  readonly body: string;
  readonly cacheControl: string;
};

const navigation = `
<nav aria-label="Trust and support">
  <a href="/support">Support</a> ·
  <a href="/privacy">Privacy</a> ·
  <a href="/deletion">Deletion</a> ·
  <a href="/status">Status</a> ·
  <a href="/security">Security</a>
</nav>`;

const pages: Readonly<Record<string, TrustPage>> = {
  "/support": {
    title: "bbbbb Support",
    description: "Support and product limits for the bbbbb private activity inbox.",
    cacheControl: "public, max-age=300",
    body: `
<p>bbbbb is a private iPhone inbox for encrypted Activity and Attention updates sent whenever the sender chooses.</p>
<h2>Contact</h2>
<p>Email <a href="mailto:${contactEmail}">${contactEmail}</a>. Include the app version, relay version from <a href="/health">/health</a>, approximate time, attempted operation, and whether opening or refreshing the app recovered the event.</p>
<p>Never send work or message content, Source URLs, Source profiles, QR images, pairing codes, inbox credentials, device tokens, APNs credentials, full encrypted envelopes, or other secrets.</p>
<h2>Supported flow</h2>
<p>Support covers phone-approved HTTP and CLI Sources, encrypted retention, generic alerts, automatic or manual offline catch-up, Source lifecycle controls, and local triage for one private inbox and one receiving iPhone.</p>
<h2>Known limits</h2>
<ul>
  <li>Free offline catch-up covers up to the newest 100 encrypted updates retained for seven days. Plus covers up to 500 retained for 30 days.</li>
  <li>Notifications are generic. Opening the app checks for retained updates automatically; Plan &amp; Usage also provides <strong>Check now</strong>.</li>
  <li>Offline catch-up does not restore an update deleted on the iPhone and does not transfer an Inbox to another phone.</li>
  <li>Each Source has independent write access and can be disabled, replaced, or deleted from the iPhone.</li>
  <li>bbbbb has no account, web inbox, remote execution, live monitoring, or approval actions.</li>
</ul>`,
  },
  "/privacy": {
    title: "bbbbb Privacy Policy",
    description: "Privacy policy for the bbbbb app, CLI, and official hosted relay.",
    cacheControl: "public, max-age=300",
    body: `
<p><strong>Effective date:</strong> July 25, 2026</p>
<p>bbbbb protects Activity and Attention content for one private iPhone inbox. CLI Sources encrypt before transmission. HTTP Source content is normalized and sealed inside the Worker before retention. The official relay retains only protocol-2 encrypted envelopes and cannot decrypt them. Notifications contain no work, message, category, or label details.</p>
<h2>Data processed</h2>
<ul>
  <li><strong>Encrypted event envelopes:</strong> Cloudflare D1 retains up to the newest 100 per Free inbox for at most seven days and up to 500 per Plus inbox for at most 30 days. Bounded cleanup removes older envelopes.</li>
  <li><strong>Alert delivery data:</strong> an APNs device token and environment are stored until replacement or hosted deletion. Apple processes the device token and generic notification to deliver an alert.</li>
  <li><strong>Service and abuse metadata:</strong> Cloudflare and the relay process request timing, IP and network metadata, ciphertext sizes, counts, retention timestamps, bounded hashed rate-limit keys, and allowlisted operational classifications needed to operate and protect the service.</li>
  <li><strong>Add Source metadata:</strong> five-minute session state, Source name and method, public encryption key, credential hashes, and approval timing are processed to create independently revocable Sources.</li>
  <li><strong>Source transfer metadata:</strong> for up to five minutes, the relay processes a receiver label and public key, hashes of temporary proof, and replacement credential ciphertext until it is consumed once or expires. The receiver private key never leaves the receiving device, and the relay does not retain the plaintext Source URL.</li>
</ul>
<p>Data is used only for app functionality, delivery, security, abuse prevention, and service reliability. bbbbb has no advertising, cross-company tracking, third-party analytics SDK, account profile, contacts access, or location access.</p>
<h2>Data on your iPhone and computers</h2>
<p>The iPhone stores private inbox authority in device-only Keychain storage and decrypted activity in protected app storage. Individually deleted updates remain only in local Recently Deleted for up to 30 days unless restored or deleted immediately. A CLI Source stores only the inbox public key, fixed Source identity, and its independent write credential in an owner-only profile. An HTTP Source URL contains only that Source’s write credential. Local resolution and deletion state are not sent to the relay.</p>
<h2>Trust and recovery limits</h2>
<p>A Source can submit only to its assigned inbox and cannot read or decrypt history. Replacing a Source credential stops the old credential; disabling or deleting a Source stops new writes without rewriting retained history. Losing the iPhone’s private inbox key makes retained activity unrecoverable.</p>
<h2>Deletion</h2>
<p>Hosted encrypted history and alert registration are deleted separately from decrypted local history and pairing. See the <a href="/deletion">deletion instructions</a>.</p>
<h2>Contact</h2>
<p>For privacy questions, email <a href="mailto:${contactEmail}">${contactEmail}</a>. Do not include secrets or private job content.</p>`,
  },
  "/deletion": {
    title: "Delete bbbbb Data",
    description: "Instructions for deleting hosted and local bbbbb data.",
    cacheControl: "public, max-age=300",
    body: `
<p>bbbbb has no user account. The app provides two separate deletion controls in Settings.</p>
<h2>Recover an individually deleted update</h2>
<ol>
  <li>Open Settings. <strong>Recently Deleted</strong> appears only when it contains an update.</li>
  <li>Open Recently Deleted and choose <strong>Restore</strong> within 30 days.</li>
</ol>
<p>Individual deletion removes an update immediately from Attention, Activity, search, and exports. <strong>Delete Now</strong> or <strong>Delete All Now</strong> removes the local recovery copy immediately and cannot be undone. Offline catch-up does not restore locally deleted updates.</p>
<h2>Delete hosted encrypted history and stop alerts</h2>
<ol>
  <li>Open bbbbb on the paired iPhone and unlock it.</li>
  <li>Open Settings and choose <strong>Delete hosted encrypted history</strong>.</li>
  <li>Confirm <strong>Delete hosted history</strong>.</li>
</ol>
<p>The app deletes the authenticated inbox’s hosted encrypted events, Sources, linked setup and credential-transfer records, and APNs device registration. Unclaimed receiver sessions have no inbox credential and expire within five minutes. It reports success only when the hosted operation succeeds. Local decrypted history and the private inbox key remain until you delete them separately.</p>
<h2>Delete local history and pairing</h2>
<ol>
  <li>Open Settings and choose <strong>Delete local history</strong>.</li>
  <li>Confirm the local deletion.</li>
</ol>
<p>This removes decrypted history, Recently Deleted recovery copies, local resolution and deletion metadata, private inbox authority, and relay preference from that iPhone. It does not delete hosted encrypted history or stop alerts unless the hosted operation above is completed first.</p>
<p>Uninstalling the app alone is not presented as a reliable way to delete a Keychain item. For help, email <a href="mailto:${contactEmail}">${contactEmail}</a> without sending a Source URL, profile, QR image, code, token, credential, or private work content.</p>`,
  },
  "/status": {
    title: "bbbbb Service Status",
    description: "Current reachability and health information for the bbbbb relay.",
    cacheControl: "no-store",
    body: `
<p><strong>Current status:</strong> this public relay endpoint is reachable.</p>
<p>See <a href="/health">relay health and deployment provenance</a> for the machine-readable service state. This page does not claim notification delivery, a historical uptime percentage, or the status of Apple Push Notification service.</p>
<p>To report an incident, email <a href="mailto:${contactEmail}">${contactEmail}</a> with an approximate time and coarse failure classification. Do not send job content or credentials.</p>`,
  },
  "/security": {
    title: "bbbbb Security Reporting",
    description: "How to report a security issue affecting bbbbb.",
    cacheControl: "public, max-age=300",
    body: `
<p>Report suspected vulnerabilities privately to <a href="mailto:${contactEmail}">${contactEmail}</a>.</p>
<p>Include the affected component and version, a concise impact description, and safe reproduction steps. Do not include Source URLs or profiles, QR images, pairing codes, inbox credentials, device tokens, APNs credentials, real work or message text, complete encrypted envelopes, or unrelated personal data.</p>
<p>Please do not test against other people’s inboxes, degrade the hosted service, retain accessed data, or publish an issue before a reasonable remediation window has been agreed.</p>`,
  },
};

function renderPage(page: TrustPage): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${page.description}">
  <title>${page.title}</title>
</head>
<body>
<header><h1>${page.title}</h1>${navigation}</header>
<main>${page.body}</main>
<footer><p>© 2026 Shen · <a href="mailto:${contactEmail}">${contactEmail}</a></p></footer>
</body>
</html>`;
}

export function createTrustSurfaceResponse(request: Request): Response | null {
  const page = pages[new URL(request.url).pathname];
  if (page === undefined) return null;

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { ...securityHeaders, allow: "GET, HEAD", "cache-control": "no-store" },
    });
  }

  return new Response(request.method === "HEAD" ? null : renderPage(page), {
    headers: {
      ...securityHeaders,
      "cache-control": page.cacheControl,
      "content-type": "text/html; charset=utf-8",
    },
  });
}
