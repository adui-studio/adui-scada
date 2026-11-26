import { HostPreflightError, inspectRoundTripReference } from "./prisma8-native-check-roundtrip-host.mjs";
import { RoundTripReferenceError } from "./prisma8-native-check-roundtrip-reference.mjs";

try {
  const report = inspectRoundTripReference(process.platform, process.argv.slice(2), process.env);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} catch (error) {
  console.error(error instanceof RoundTripReferenceError || error instanceof HostPreflightError ? error.message : "冻结库目录采集失败，内部诊断已脱敏");
  process.exitCode = 1;
}
