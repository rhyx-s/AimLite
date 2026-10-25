# Security and privacy

AimLite is an offline application with no intentional telemetry, cloud storage or account requirement. Its normal installer can download Microsoft's WebView2 runtime if missing; Microsoft manages Evergreen updates separately. Explicit diagnostic exports can contain local paths and display information: review them before sharing.

The current preview is unsigned and has not received a clean-machine or malware-sandbox certification. The imported-preview resource-exhaustion issue and backup/data-integrity concerns found during the source audit were fixed for 0.1.1 and covered by regression tests. See [release status](docs/RELEASE-STATUS.md).

For vulnerabilities use **Security > Report a vulnerability** if the public repository enables private reporting. Otherwise open an issue requesting a private contact without including exploit details or credentials. Do not post private databases, tokens or personal diagnostic paths publicly.

Only the current development version receives maintenance. Locked dependencies improve reproducibility; they are not a guarantee of safety. Recheck advisories and relevant regression tests before each release.
