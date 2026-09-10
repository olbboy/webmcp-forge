import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.WEBMCP_DATA_DIR = mkdtempSync(path.join(tmpdir(), "webmcp-forge-"));

// The fixture server runs on 127.0.0.1, which the scan guard refuses by
// default. Tests that exercise the guard itself switch this back off.
process.env.SCAN_ALLOW_PRIVATE_HOSTS = "1";
// Independent of the line above, so tests/ssrf.test.ts can switch the
// pre-flight check off and the post-navigation check on, and prove which
// one refused.
process.env.SCAN_ENFORCE_CONNECTED_IP = "0";
