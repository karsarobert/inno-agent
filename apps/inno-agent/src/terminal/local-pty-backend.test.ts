import { describe, expect, it } from "vitest";
import { resolvePtyLaunch } from "./local-pty-backend.js";

const allExist = (_path: string) => true;

describe("resolvePtyLaunch", () => {
	it("keeps the direct shell path when sandbox is disabled", () => {
		expect(resolvePtyLaunch(
			{ shell: "/bin/bash", cwd: "/srv/work", sandbox: false },
			{ platform: "linux", exists: allExist },
		)).toEqual({ file: "/bin/bash", args: [], cwd: "/srv/work" });
	});

	it("wraps Practice Lab in a networkless bwrap workspace sandbox", () => {
		const launch = resolvePtyLaunch(
			{ shell: "/bin/bash", cwd: "/srv/user/workspace/cpp", sandbox: true },
			{ platform: "linux", exists: allExist },
		);
		expect(launch.file).toBe("/usr/bin/bwrap");
		expect(launch.cwd).toBe("/srv/user/workspace/cpp");
		expect(launch.args).toContain("--unshare-net");
		expect(launch.args).toContain("--unshare-pid");
		expect(launch.args).toContain("--new-session");
		expect(launch.args).toContain("--tmpfs");
		expect(launch.args).toContain("/tmp");
		expect(launch.args).toContain("--bind");
		expect(launch.args).toContain("/srv/user/workspace/cpp");
		expect(launch.args).toContain("/workspace");
		expect(launch.args).toContain("--chdir");
		expect(launch.args).toContain("--ro-bind");
		expect(launch.args).toContain("/usr");
		expect(launch.args.slice(-3)).toEqual(["/bin/bash", "--noprofile", "--norc"]);
	});

	it("uses a fixed bash inside the sandbox instead of inherited SHELL", () => {
		const launch = resolvePtyLaunch(
			{ shell: "/usr/bin/fish", cwd: "/srv/work", sandbox: true },
			{ platform: "linux", exists: allExist },
		);
		expect(launch.args.slice(-3)).toEqual(["/bin/bash", "--noprofile", "--norc"]);
	});

	it("fails closed when bwrap is unavailable", () => {
		expect(() => resolvePtyLaunch(
			{ shell: "/bin/bash", cwd: "/srv/work", sandbox: true },
			{ platform: "linux", exists: () => false },
		)).toThrow(/bwrap/i);
	});

	it("fails closed on unsupported platforms", () => {
		expect(() => resolvePtyLaunch(
			{ shell: "powershell.exe", cwd: "C:\\work", sandbox: true },
			{ platform: "win32", exists: allExist },
		)).toThrow(/Linux/i);
	});
});
