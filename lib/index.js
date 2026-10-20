export const name = 'powerbox'

export function apply() {
  // Client-only plugin: the power button and its confirmation dialogs live in
  // lib/client.js. The host half exists only so the package is a valid cordis
  // bundle (loader requires name/apply).
}
