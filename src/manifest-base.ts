/**
 * Base shape for the deploy manifest that adapters emit after a
 * successful build. Each adapter writes a manifest.json describing
 * the build output enough for its downstream consumer (CF control-
 * plane uploader, creekd's `--from <manifest.json>` spawn path,
 * future adapters) to know how to deploy and run.
 *
 * This is the *base* — adapters add target-specific fields on top
 * via structural extension. Examples of fields that belong on the
 * *adapter* side, NOT here:
 *
 *   - CF Workers:  compatibilityDate, compatibilityFlags, doBindings
 *   - creekd:      runtime ("bun" | "node"), port, healthCheckPath
 *
 * Keeping those out of the base lets each adapter version its own
 * concrete shape independently of the others. The base evolves only
 * when there's something every adapter genuinely needs.
 */
export interface DeployManifestBase {
  /** Manifest schema version. Increment on breaking shape changes. */
  version: 1;
  /** Framework identifier. Only "nextjs" today; reserved for future framework adapters. */
  framework: "nextjs";
  /** Next.js build ID (from `.next/BUILD_ID`). */
  buildId: string;
  /** Next.js version the build ran under. */
  nextVersion: string;
  /**
   * Adapter package name + version that produced this manifest.
   * Useful for the consumer to log which adapter wrote the artifact
   * and to fail fast on unknown / future versions.
   */
  adapter: {
    name: string;
    version: string;
  };
  /** Whether the build emitted a middleware bundle. */
  hasMiddleware: boolean;
  /**
   * Whether the build emitted prerendered pages or `'use cache'`
   * entries. Signals to the consumer that an ISR cache backing store
   * may be required.
   */
  hasPrerender: boolean;
}
