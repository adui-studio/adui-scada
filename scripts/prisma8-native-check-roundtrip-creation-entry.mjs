import {
  HostPreflightError,
  inspectRoundTripReference,
} from "./prisma8-native-check-roundtrip-host.mjs";
import { RoundTripReferenceError } from "./prisma8-native-check-roundtrip-reference.mjs";
import {
  buildRoundTripCreationPlan,
  RoundTripCreationError,
} from "./prisma8-native-check-roundtrip-creation.mjs";

try {
  const reference = inspectRoundTripReference(process.platform, process.argv.slice(2), process.env);
  const report = buildRoundTripCreationPlan(reference);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} catch (error) {
  console.error(
    error instanceof HostPreflightError ||
      error instanceof RoundTripReferenceError ||
      error instanceof RoundTripCreationError
      ? error.message
      : "第五座创建计划核验失败，内部诊断已脱敏",
  );
  process.exitCode = 1;
}
