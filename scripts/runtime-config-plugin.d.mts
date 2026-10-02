import type { Plugin } from 'vite'

export declare const RUNTIME_CONFIG_NAMES: readonly string[]
export declare function renderRuntimeConfig(env: Record<string, unknown>): string
export declare function runtimeConfigPlugin(): Plugin
