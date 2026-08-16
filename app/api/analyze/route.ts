import { NextRequest, NextResponse } from "next/server";

const ignored = ["node_modules", ".git", ".next", "dist", "build", "coverage", ".turbo", ".cache", "vendor", "target", "out"];

type RemoteFile = { path: string; size?: number; type?: string };
type IndexedFile = RemoteFile & { content?: string };
const textExtensions = new Set(["ts","tsx","js","jsx","mjs","cjs","json","py","go","rs","java","kt","rb","php","vue","svelte","css","scss","html","md","yml","yaml","toml","sql","graphql","gql","sh"]);

function parseRepository(raw: string) {
  const url = new URL(raw);
  const parts = url.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/").filter(Boolean);
  if (url.hostname === "github.com" && parts.length >= 2) return { provider: "GitHub", owner: parts[0], name: parts[1], key: `${parts[0]}/${parts[1]}` };
  if (url.hostname === "gitlab.com" && parts.length >= 2) return { provider: "GitLab", owner: parts.slice(0, -1).join("/"), name: parts.at(-1)!, key: parts.join("/") };
  if (url.hostname === "bitbucket.org" && parts.length >= 2) return { provider: "Bitbucket", owner: parts[0], name: parts[1], key: `${parts[0]}/${parts[1]}` };
  throw new Error("Use a public GitHub, GitLab, or Bitbucket repository URL.");
}

function include(path: string) { return !path.split("/").some((part) => ignored.includes(part)); }

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json() as { url?: string };
    if (!url) throw new Error("Repository URL is required.");
    const repo = parseRepository(url);
    let branch = "main";
    let description = "";
    let stars = 0;
    let files: RemoteFile[] = [];
    let branches: string[] = [];
    let commits: Array<{ sha: string; message: string; author: string; date: string }> = [];

    if (repo.provider === "GitHub") {
      const infoResponse = await fetch(`https://api.github.com/repos/${repo.key}`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "RepoCompass" } });
      if (!infoResponse.ok) throw new Error(infoResponse.status === 404 ? "Repository not found or not public." : `GitHub returned ${infoResponse.status}. Try again shortly.`);
      const info = await infoResponse.json() as { default_branch: string; description?: string; stargazers_count?: number };
      branch = info.default_branch; description = info.description ?? ""; stars = info.stargazers_count ?? 0;
      const [branchesResponse, commitsResponse] = await Promise.all([
        fetch(`https://api.github.com/repos/${repo.key}/branches?per_page=100`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "RepoCompass" } }),
        fetch(`https://api.github.com/repos/${repo.key}/commits?per_page=20`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "RepoCompass" } }),
      ]);
      if (branchesResponse.ok) branches = ((await branchesResponse.json()) as Array<{name:string}>).map(x=>x.name);
      if (commitsResponse.ok) commits = ((await commitsResponse.json()) as Array<{sha:string;commit:{message:string;author?:{name?:string;date?:string}}}>).map(x=>({sha:x.sha.slice(0,7),message:x.commit.message.split("\n")[0],author:x.commit.author?.name||"Unknown",date:x.commit.author?.date||""}));
      const treeResponse = await fetch(`https://api.github.com/repos/${repo.key}/git/trees/${encodeURIComponent(branch)}?recursive=1`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "RepoCompass" } });
      if (!treeResponse.ok) throw new Error("Could not read the repository tree.");
      const tree = await treeResponse.json() as { tree: Array<{ path: string; type: string; size?: number }>; truncated?: boolean };
      files = tree.tree.filter((item) => item.type === "blob").map((item) => ({ path: item.path, size: item.size, type: item.type }));
    } else if (repo.provider === "GitLab") {
      const projectId = encodeURIComponent(repo.key);
      const infoResponse = await fetch(`https://gitlab.com/api/v4/projects/${projectId}`);
      if (!infoResponse.ok) throw new Error(infoResponse.status === 404 ? "Repository not found or not public." : `GitLab returned ${infoResponse.status}.`);
      const info = await infoResponse.json() as { default_branch: string; description?: string; star_count?: number };
      branch = info.default_branch; description = info.description ?? ""; stars = info.star_count ?? 0;
      const branchesResponse = await fetch(`https://gitlab.com/api/v4/projects/${projectId}/repository/branches?per_page=100`);
      if (branchesResponse.ok) branches = ((await branchesResponse.json()) as Array<{name:string}>).map(x=>x.name);
      const treeResponse = await fetch(`https://gitlab.com/api/v4/projects/${projectId}/repository/tree?recursive=true&per_page=100`);
      if (!treeResponse.ok) throw new Error("Could not read the repository tree.");
      const tree = await treeResponse.json() as Array<{ path: string; type: string }>;
      files = tree.filter((item) => item.type === "blob");
    } else {
      const infoResponse = await fetch(`https://api.bitbucket.org/2.0/repositories/${repo.key}`);
      if (!infoResponse.ok) throw new Error(infoResponse.status === 404 ? "Repository not found or not public." : `Bitbucket returned ${infoResponse.status}.`);
      const info = await infoResponse.json() as { mainbranch?: { name: string }; description?: string };
      branch = info.mainbranch?.name ?? "main"; description = info.description ?? "";
      const branchesResponse = await fetch(`https://api.bitbucket.org/2.0/repositories/${repo.key}/refs/branches?pagelen=100`);
      if (branchesResponse.ok) branches = ((await branchesResponse.json()) as {values:Array<{name:string}>}).values.map(x=>x.name);
      const treeResponse = await fetch(`https://api.bitbucket.org/2.0/repositories/${repo.key}/src/${encodeURIComponent(branch)}/?pagelen=100&max_depth=10`);
      if (!treeResponse.ok) throw new Error("Could not read the repository tree.");
      const tree = await treeResponse.json() as { values: Array<{ path: string; type: string; size?: number }> };
      files = tree.values.filter((item) => item.type === "commit_file").map((item) => ({ path: item.path, size: item.size }));
    }

    const accepted = files.filter((file) => include(file.path));
    const excluded = files.length - accepted.length;
    const extensions = new Map<string, number>();
    for (const file of accepted) { const extension = file.path.split(".").at(-1)?.toLowerCase() ?? "other"; extensions.set(extension, (extensions.get(extension) ?? 0) + 1); }
    const languages = [...extensions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => ({ name, count }));

    const contentCandidates = accepted.filter(file => textExtensions.has(file.path.split(".").at(-1)?.toLowerCase()||"") && (file.size||0) <= 120_000).slice(0, 80);
    const indexedFiles: IndexedFile[] = await Promise.all(contentCandidates.map(async file => {
      try {
        let raw = "";
        if (repo.provider === "GitHub") raw = `https://raw.githubusercontent.com/${repo.key}/${encodeURIComponent(branch)}/${file.path.split("/").map(encodeURIComponent).join("/")}`;
        else if (repo.provider === "GitLab") raw = `https://gitlab.com/api/v4/projects/${encodeURIComponent(repo.key)}/repository/files/${encodeURIComponent(file.path)}/raw?ref=${encodeURIComponent(branch)}`;
        else raw = `https://api.bitbucket.org/2.0/repositories/${repo.key}/src/${encodeURIComponent(branch)}/${file.path.split("/").map(encodeURIComponent).join("/")}`;
        const response = await fetch(raw);
        if (!response.ok) return file;
        return { ...file, content: (await response.text()).slice(0, 120_000) };
      } catch { return file; }
    }));
    return NextResponse.json({ ...repo, branch, branches: branches.length?branches:[branch], commits, description, stars, files: accepted.length, ignored: excluded, bytes: accepted.reduce((sum, file) => sum + (file.size ?? 0), 0), languages, sampleFiles: accepted.slice(0, 5000).map((file) => file.path), indexedFiles, exclusions: ignored, analyzedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Analysis failed." }, { status: 400 });
  }
}
