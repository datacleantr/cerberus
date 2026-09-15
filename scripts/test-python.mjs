import { spawnSync } from "node:child_process";
import { delimiter, resolve } from "node:path";

const python = process.platform === "win32" ? "python" : "python3";
const serviceDir = resolve(process.cwd(), "services/scrapling");
const env = {
  ...process.env,
  PYTHONPATH: [serviceDir, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
};

for (const args of [
  ["-m", "unittest", "discover", "-s", serviceDir, "-p", "test_*.py", "-v"],
  ["-m", "py_compile", resolve(serviceDir, "main.py"), resolve(serviceDir, "security.py")],
]) {
  const result = spawnSync(python, args, { env, stdio: "inherit" });
  if (result.error) {
    console.error(`Python çalıştırılamadı: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
