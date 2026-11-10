import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseActivityLines } from "../src/domain/attention/ActivityEvent.ts";
import { localDate } from "../src/domain/attention/GardenClock.ts";
import {
  commitTimes,
  discoverRepos,
  drawGit,
  fetchLinearIssues,
  gitDayEvents,
  gitFreeEnv,
  LINEAR_QUERY,
  type LinearPage,
  linearEvents,
  recentDays,
  runSpring,
} from "./springs.ts";

const LINEAR_FIXTURE = JSON.parse(
  fs.readFileSync(
    path.join(import.meta.dirname, "fixtures", "linear-assigned-issues.json"),
    "utf8",
  ),
) as LinearPage;

const at = (day: string, h: number, m = 0) => {
  const [y, mo, d] = day.split("-").map(Number);
  return new Date(y, mo - 1, d, h, m).getTime();
};

const tmp = (prefix: string) =>
  fs.mkdtempSync(path.join(os.tmpdir(), `zenborg-spring-${prefix}-`));

// Isolated from the machine's git config: no signing, no hooks, no identity.
// And from any GIT_DIR the husky hook exports, or the fixture would write
// into the repo running the tests.
const GIT_ENV = {
  ...gitFreeEnv(),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

function initRepo(dir: string, email = "gardener@example.com"): string {
  fs.mkdirSync(dir, { recursive: true });
  const run = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], {
      env: GIT_ENV,
      stdio: "ignore",
    });
  run("init", "-q");
  run("config", "user.email", email);
  run("config", "user.name", "Gardener");
  return dir;
}

function commit(
  repo: string,
  ts: number,
  message: string,
  author = "gardener@example.com",
) {
  const date = `@${Math.floor(ts / 1000)} +0000`;
  execFileSync(
    "git",
    [
      "-C",
      repo,
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      message,
      `--author=Someone <${author}>`,
    ],
    {
      env: { ...GIT_ENV, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      stdio: "ignore",
    },
  );
}

describe("recentDays", () => {
  it("is the last n calendar days ending today, oldest first", () => {
    expect(recentDays(new Date(at("2026-10-09", 12)), 3)).toEqual([
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
    ]);
  });
});

describe("discoverRepos", () => {
  it("finds repos under a plot's path two levels down, and nothing else", () => {
    const root = tmp("discover");
    const alpha = initRepo(path.join(root, "alpha"));
    const beta = initRepo(path.join(root, "group", "beta"));
    initRepo(path.join(root, "a", "b", "too-deep"));
    initRepo(path.join(root, "node_modules", "dep"));
    initRepo(path.join(root, ".hidden"));
    initRepo(path.join(alpha, "inside")); // nested in a repo: never descended into
    // A linked worktree's `.git` is a file; its commits are its main repo's.
    fs.mkdirSync(path.join(root, "worktree"));
    fs.writeFileSync(
      path.join(root, "worktree", ".git"),
      "gitdir: elsewhere\n",
    );

    expect(discoverRepos([root, path.join(root, "missing")])).toEqual([
      alpha,
      beta,
    ]);
    // A path that is itself a repo.
    expect(discoverRepos([alpha])).toEqual([alpha]);
  });
});

describe("git spring", () => {
  it("counts the repo's own commits per waking day, from author times only", () => {
    const repo = initRepo(path.join(tmp("count"), "alpha"));
    // Chronological, as real history is: --since stops at the first older commit.
    commit(repo, at("2026-09-01", 9), "long ago");
    commit(repo, at("2026-10-05", 10), "secret plans one");
    commit(repo, at("2026-10-05", 11), "not mine", "other@example.com");
    commit(repo, at("2026-10-05", 15), "secret plans two");
    // 02:00 on the 7th is still the 6th's waking day.
    commit(repo, at("2026-10-07", 2), "late night");

    const times = commitTimes(repo, at("2026-10-05", 4), at("2026-10-08", 4));
    expect(times).toHaveLength(3);

    const events = gitDayEvents(repo, times);
    expect(
      events.map((e) => [e.payload.repo, e.payload.commits, e.ts]),
    ).toEqual([
      ["alpha", 2, at("2026-10-05", 4)],
      ["alpha", 1, at("2026-10-06", 4)],
    ]);
  });

  it("writes repo + count per day, no message, and a rerun rewrites rather than appends", () => {
    const vault = tmp("vault");
    const plot = tmp("plot");
    const alpha = initRepo(path.join(plot, "alpha"));
    const beta = initRepo(path.join(plot, "beta"));
    commit(alpha, at("2026-10-05", 10), "secret plans");
    commit(beta, at("2026-10-05", 12), "more secrets");
    commit(beta, at("2026-10-06", 12), "more secrets again");
    const areas = [{ surfaces: { paths: [plot] } }, {}];
    const days = ["2026-10-05", "2026-10-06", "2026-10-07"];

    drawGit(vault, areas, days);
    const file = path.join(vault, "log", "2026-10-05.git.jsonl");
    const first = fs.readFileSync(file, "utf8");
    drawGit(vault, areas, days);
    expect(fs.readFileSync(file, "utf8")).toBe(first);

    const lines = parseActivityLines(first, "git");
    expect(lines.map((e) => [e.payload.repo, e.payload.commits])).toEqual([
      ["alpha", 1],
      ["beta", 1],
    ]);
    expect(first).not.toMatch(/secret/);
    expect(fs.existsSync(path.join(vault, "log", "2026-10-06.git.jsonl"))).toBe(
      true,
    );
    // A day with no commits has no file.
    expect(fs.existsSync(path.join(vault, "log", "2026-10-07.git.jsonl"))).toBe(
      false,
    );

    // A run that cannot see alpha and beta (an unmounted drive) keeps their lines.
    const gone = path.join(tmp("other-plot"), "gamma");
    initRepo(gone);
    drawGit(vault, [{ surfaces: { paths: [path.dirname(gone)] } }], days);
    expect(fs.readFileSync(file, "utf8")).toBe(first);
  });

  it("a rerun keeps the day line of a repo it did not discover", () => {
    const vault = tmp("undiscovered");
    const plotA = tmp("plot-a");
    const plotB = tmp("plot-b");
    const alpha = initRepo(path.join(plotA, "alpha"));
    const beta = initRepo(path.join(plotB, "beta"));
    commit(alpha, at("2026-10-05", 10), "a");
    commit(beta, at("2026-10-05", 12), "b");
    const days = ["2026-10-05"];
    drawGit(
      vault,
      [{ surfaces: { paths: [plotA] } }, { surfaces: { paths: [plotB] } }],
      days,
    );
    // plot B's drive is gone this run.
    drawGit(vault, [{ surfaces: { paths: [plotA] } }], days);
    const text = fs.readFileSync(
      path.join(vault, "log", "2026-10-05.git.jsonl"),
      "utf8",
    );
    expect(parseActivityLines(text, "git").map((e) => e.payload.repo)).toEqual([
      "alpha",
      "beta",
    ]);
  });

  describe("never erases history on a partial run", () => {
    const days = ["2026-10-05", "2026-10-06"];
    const kept = (vault: string) => {
      const file = path.join(vault, "log", "2026-10-05.git.jsonl");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '{"kept":true}\n');
      return file;
    };

    it("when no repos are found", () => {
      const vault = tmp("norepos");
      const file = kept(vault);
      const empty = tmp("empty-plot");
      expect(drawGit(vault, [], days)).toBe(0);
      expect(drawGit(vault, [{ surfaces: { paths: [empty] } }], days)).toBe(0);
      expect(fs.readFileSync(file, "utf8")).toBe('{"kept":true}\n');
    });

    it("when areas.json is missing or unreadable", async () => {
      const vault = tmp("novault");
      const file = kept(vault);
      const now = new Date(at("2026-10-06", 12));
      expect(await runSpring(vault, ["git", "--days", "2"], {}, now)).toBe(1);
      fs.mkdirSync(path.join(vault, "areas.json")); // a directory: read throws
      expect(await runSpring(vault, ["git", "--days", "2"], {}, now)).toBe(1);
      expect(fs.readFileSync(file, "utf8")).toBe('{"kept":true}\n');
    });

    it("when a git call fails", async () => {
      const vault = tmp("gitfail");
      const file = kept(vault);
      const plot = tmp("gitfail-plot");
      const good = initRepo(path.join(plot, "alpha"));
      commit(good, at("2026-10-05", 10), "work");
      const bad = initRepo(path.join(plot, "beta"));
      commit(bad, at("2026-10-05", 11), "work");
      fs.writeFileSync(path.join(bad, ".git", "HEAD"), "garbage\n"); // log fails
      fs.writeFileSync(
        path.join(vault, "areas.json"),
        JSON.stringify({ a1: { id: "a1", surfaces: { paths: [plot] } } }),
      );
      expect(() => commitTimes(bad, 0, Date.now())).toThrow();
      const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      const code = await runSpring(
        vault,
        ["git", "--days", "2"],
        {},
        new Date(at("2026-10-06", 12)),
      );
      stderr.mockRestore();
      expect(code).toBe(1);
      // Neither the old file nor the healthy repo's fresh line was touched.
      expect(fs.readFileSync(file, "utf8")).toBe('{"kept":true}\n');
    });
  });

  it("runs as `spring git` over the vault's areas", async () => {
    const vault = tmp("cli");
    const plot = tmp("cli-plot");
    const alpha = initRepo(path.join(plot, "alpha"));
    commit(alpha, at("2026-10-08", 10), "work");
    fs.writeFileSync(
      path.join(vault, "areas.json"),
      JSON.stringify({
        a1: { id: "a1", name: "Plot", surfaces: { paths: [plot] } },
      }),
    );
    const code = await runSpring(
      vault,
      ["git", "--days", "2"],
      {},
      new Date(at("2026-10-09", 12)),
    );
    expect(code).toBe(0);
    const text = fs.readFileSync(
      path.join(vault, "log", "2026-10-08.git.jsonl"),
      "utf8",
    );
    expect(parseActivityLines(text, "git")[0].payload).toEqual({
      repo: "alpha",
      cwd: alpha,
      commits: 1,
    });
  });

  it("exits non-zero and keeps the files when areas.json is unreadable", async () => {
    const vault = tmp("torn");
    fs.writeFileSync(path.join(vault, "areas.json"), "{ torn");
    const kept = path.join(vault, "log", "2026-10-08.git.jsonl");
    fs.mkdirSync(path.dirname(kept));
    fs.writeFileSync(kept, "{}\n");
    expect(
      await runSpring(vault, ["git"], {}, new Date(at("2026-10-09", 12))),
    ).toBe(1);
    expect(fs.existsSync(kept)).toBe(true);
  });
});

const fakeFetch = (pages: readonly LinearPage[]) => {
  const calls: { headers: Record<string, string>; body: string }[] = [];
  const impl = (async (_url: string, init: RequestInit) => {
    calls.push({
      headers: init.headers as Record<string, string>,
      body: init.body as string,
    });
    return new Response(JSON.stringify(pages[calls.length - 1]), {
      status: 200,
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
};

describe("linear spring", () => {
  it("never asks for a title, a description, a comment or a body", () => {
    expect(LINEAR_QUERY).not.toMatch(/title|description|comment|body/i);
  });

  it("maps each state change to issue id, from → to, ts; nothing else rides along", () => {
    const issues = LINEAR_FIXTURE.data?.viewer?.assignedIssues?.nodes ?? [];
    const events = linearEvents(issues, "user-me");
    expect(events.map((e) => [e.payload, e.ts])).toEqual([
      [
        { issue: "ABC-101", from: "In Progress", to: "In Review" },
        Date.parse("2026-10-08T09:15:00.000Z"),
      ],
      [
        { issue: "ABC-101", from: "Todo", to: "In Progress" },
        Date.parse("2026-10-07T16:40:00.000Z"),
      ],
      [
        { issue: "ABC-102", from: null, to: "Backlog" },
        Date.parse("2026-10-08T11:00:00.000Z"),
      ],
    ]);
    expect(events.every((e) => e.surface === "linear" && !e.durationMs)).toBe(
      true,
    );
    expect(JSON.stringify(events)).not.toMatch(/title|never reach/i);
  });

  it("counts only the viewer's own moves, not a teammate's or an unattributed one", () => {
    const issues = LINEAR_FIXTURE.data?.viewer?.assignedIssues?.nodes ?? [];
    const to = (id: string) =>
      linearEvents(issues, id).map((e) => e.payload.to);
    expect(to("user-me")).not.toContain("Done");
    expect(to("user-me")).not.toContain("Archived");
    expect(to("user-teammate")).toEqual(["Done"]);
    expect(LINEAR_QUERY).toMatch(/actor\s*{\s*id\s*}/);
  });

  it("follows pages and sends the key as the Authorization header", async () => {
    const page1: LinearPage = {
      data: {
        viewer: {
          id: "user-me",
          assignedIssues: {
            pageInfo: { hasNextPage: true, endCursor: "c1" },
            nodes: [{ identifier: "ABC-1" }],
          },
        },
      },
    };
    const { impl, calls } = fakeFetch([page1, LINEAR_FIXTURE]);
    const { viewerId, issues } = await fetchLinearIssues(
      "test-key",
      new Date(0),
      impl,
    );
    expect(viewerId).toBe("user-me");
    expect(issues).toHaveLength(4);
    expect(calls[0].headers.Authorization).toBe("test-key");
    expect(JSON.parse(calls[1].body).variables.after).toBe("c1");
  });

  it("writes log/<day>.linear.jsonl and a rerun rewrites the day", async () => {
    const vault = tmp("linear");
    const now = new Date("2026-10-09T12:00:00.000Z");
    const env = { LINEAR_API_KEY: "test-key" };
    const run = () =>
      runSpring(
        vault,
        ["linear", "--days", "3"],
        env,
        now,
        fakeFetch([LINEAR_FIXTURE]).impl,
      );

    expect(await run()).toBe(0);
    const day = (ts: string) => localDate(Date.parse(ts));
    const file = path.join(
      vault,
      "log",
      `${day("2026-10-08T09:15:00.000Z")}.linear.jsonl`,
    );
    const first = fs.readFileSync(file, "utf8");
    expect(await run()).toBe(0);
    expect(fs.readFileSync(file, "utf8")).toBe(first);
    const lines = parseActivityLines(first, "linear");
    expect(new Set(lines.map((e) => e.payload.issue))).toEqual(
      new Set(["ABC-101", "ABC-102"]),
    );
    expect(lines.map((e) => e.payload.to)).not.toContain("Done");
    expect(first).not.toMatch(/never reach|test-key/);
  });

  it("keeps an earlier move after its issue is reassigned away", async () => {
    const vault = tmp("linear-reassigned");
    const now = new Date("2026-10-09T12:00:00.000Z");
    const run = (page: LinearPage) =>
      runSpring(
        vault,
        ["linear", "--days", "3"],
        { LINEAR_API_KEY: "k" },
        now,
        fakeFetch([page]).impl,
      );
    await run(LINEAR_FIXTURE);
    const file = path.join(
      vault,
      "log",
      `${localDate(Date.parse("2026-10-08T09:15:00.000Z"))}.linear.jsonl`,
    );
    const first = fs.readFileSync(file, "utf8");
    // Next run the viewer no longer has any issue assigned.
    await run({
      data: {
        viewer: {
          id: "user-me",
          assignedIssues: {
            pageInfo: { hasNextPage: false },
            nodes: [],
          },
        },
      },
    });
    expect(fs.readFileSync(file, "utf8")).toBe(first);
  });

  it("exits 1 quietly, writing nothing, when LINEAR_API_KEY is absent", async () => {
    const vault = tmp("nokey");
    const { impl, calls } = fakeFetch([LINEAR_FIXTURE]);
    const stderr = vi.spyOn(process.stderr, "write");
    expect(await runSpring(vault, ["linear"], {}, new Date(), impl)).toBe(1);
    expect(calls).toHaveLength(0);
    expect(stderr).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(vault, "log"))).toBe(false);
    stderr.mockRestore();
  });

  it("exits 1 and keeps the files when the API errors", async () => {
    const vault = tmp("apierr");
    const impl = (async () =>
      new Response("{}", { status: 500 })) as unknown as typeof fetch;
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    expect(
      await runSpring(
        vault,
        ["linear"],
        { LINEAR_API_KEY: "k" },
        new Date(),
        impl,
      ),
    ).toBe(1);
    expect(fs.existsSync(path.join(vault, "log"))).toBe(false);
    stderr.mockRestore();
  });
});
