import type { DeviceValidation, ProductResolution, Specification } from "./types";

export function validateDevice(
  resolution: ProductResolution,
  specifications: Specification[],
): DeviceValidation {
  const cpu = specifications.find((spec) => spec.field === "cpu");
  const ram = specifications.find((spec) => spec.field === "ram");
  const checks: DeviceValidation["checks"] = [
    {
      key: "identity",
      label: "HP product identity resolved",
      status: resolution.selected ? "pass" : resolution.status === "UNRESOLVED" ? "fail" : "review",
      detail: resolution.reason,
    },
    {
      key: "cpu-evidence",
      label: "CPU supported by serial-specific evidence",
      status: cpu?.serialSpecific ? "pass" : cpu ? "review" : "fail",
      detail: cpu?.serialSpecific ? "CPU was parsed from an HP serial configuration line." : "No serial-specific CPU evidence is available.",
    },
    {
      key: "ram-evidence",
      label: "RAM supported by serial-specific evidence",
      status: ram?.serialSpecific ? "pass" : ram ? "review" : "fail",
      detail: ram?.serialSpecific ? "RAM was parsed from HP serial configuration line(s)." : ram?.reviewReason ?? "No RAM evidence is available.",
    },
  ];

  if (resolution.status === "UNRESOLVED") {
    return { status: "UNRESOLVED", reason: resolution.reason, checks };
  }
  const reviewReasons = [
    resolution.status === "REVIEW REQUIRED" ? resolution.reason : "",
    !cpu?.serialSpecific ? "CPU is not confirmed by serial-specific HP evidence." : "",
    !ram?.serialSpecific ? (ram?.reviewReason ?? "RAM is not confirmed by serial-specific HP evidence.") : "",
  ].filter(Boolean);
  return reviewReasons.length
    ? { status: "REVIEW REQUIRED", reason: reviewReasons.join(" "), checks }
    : { status: "VERIFIED", reason: "HP product identity, CPU, and RAM are supported by serial-specific evidence.", checks };
}
