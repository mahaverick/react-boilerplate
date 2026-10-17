/** Whether this browser runs on an Apple platform, where the palette shortcut is spelled ⌘K. */
export function isApplePlatform(): boolean {
  return /mac|iphone|ipad|ipod/i.test(navigator.platform)
}

/** The palette shortcut as this platform spells it: `⌘K` on Apple platforms, `Ctrl K` elsewhere. */
export function paletteShortcutHint(): string {
  return isApplePlatform() ? '⌘K' : 'Ctrl K'
}
