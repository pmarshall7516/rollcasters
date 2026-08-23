import type { DesktopProfile } from "./desktop-profile";

export type DiagnosticContext = {
  state: "update-required" | "update-check-error" | "install-error";
  availableVersion?: string;
  errorClass?: string;
};

export function diagnosticReport(profile: DesktopProfile, appVersion: string, context: DiagnosticContext, generatedAt = new Date().toISOString()) {
  return {
    schemaVersion: 1,
    generatedAt,
    app: { version: appVersion, profile: profile.profile, environment: profile.environment, channel: profile.channel, appId: profile.appId },
    server: { projectRef: profile.projectRef },
    updater: { state: context.state, availableVersion: context.availableVersion ?? null, errorClass: context.errorClass ?? null },
    runtime: { online: typeof navigator === "undefined" ? null : navigator.onLine, userAgent: typeof navigator === "undefined" ? null : navigator.userAgent },
  };
}

export function downloadDiagnosticReport(profile: DesktopProfile, appVersion: string, context: DiagnosticContext): void {
  const body = JSON.stringify(diagnosticReport(profile, appVersion, context), null, 2);
  const url = URL.createObjectURL(new Blob([`${body}\n`], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `rollcasters-diagnostics-${profile.profile}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
