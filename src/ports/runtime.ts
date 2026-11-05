/**
 * @file The runtime port: build-mode facts a shared file reads. Each app
 * writes its own copy; shared files never read `import.meta.env`.
 */

/** Whether this is a development build, where shared code may log its warnings. */
export const isDev: boolean = import.meta.env.DEV
