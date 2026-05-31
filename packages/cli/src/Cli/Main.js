export const argv = () => process.argv;
export const writeStdout = (s) => () => {
  process.stdout.write(s);
};
export const writeStderr = (s) => () => {
  process.stderr.write(s);
};
export const setExitCode = (code) => () => {
  process.exitCode = code;
};
