// Effective build defaults shared by standalone qualification and staging deployment.
// Explicit environment values always win, including "false".
export function applyReleaseBuildDefaults(env = process.env, defaults = {}) {
  env.VITE_PRACTICE_LOUDNESS_ENABLED ??= defaults.VITE_PRACTICE_LOUDNESS_ENABLED ?? "true";
  return env;
}
