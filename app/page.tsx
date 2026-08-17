"use client";
import { useMemo, useRef, useState } from "react";
import { contentModel } from "@/lib/analysis/content-model";
import { codeExtensions, extensionOf } from "@/lib/analysis/file-classification";
import type { AnalyzeRepositoryResponse, Repo } from "@/lib/domain/repository";
import type { Model } from "@/lib/domain/repository-model";

type View =
  | "overview"
  | "explorer"
  | "impact"
  | "ask"
  | "architecture"
  | "security"
  | "risks"
  | "recommendations"
  | "evolution"
  | "glossary"
  | "integrations"
  | "onboarding"
  | "compare";
const ignored = [
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".cache",
  "vendor",
  "target",
  "out",
];
const nav: Array<{ id: View; label: string; icon: string }> = [
  { id: "overview", label: "Overview", icon: "⌂" },
  { id: "explorer", label: "Code explorer", icon: "⌘" },
  { id: "impact", label: "Impact lab", icon: "◎" },
  { id: "ask", label: "Ask repository", icon: "✦" },
  { id: "architecture", label: "Architecture", icon: "◇" },
  { id: "security", label: "Security", icon: "◈" },
  { id: "risks", label: "Risks & coupling", icon: "△" },
  { id: "recommendations", label: "Recommendations", icon: "✓" },
  { id: "evolution", label: "Architecture drift", icon: "⌁" },
  { id: "glossary", label: "Glossary", icon: "Aa" },
  { id: "integrations", label: "Integrations", icon: "＋" },
  { id: "onboarding", label: "Contributor path", icon: "↗" },
  { id: "compare", label: "Branches", icon: "⇄" },
];
function bytes(value: number) {
  if (!value) return "0 B";
  const u = ["B", "KB", "MB", "GB"],
    i = Math.min(3, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}
export default function Home() {
  const [repo, setRepo] = useState<Repo | null>(null),
    [view, setView] = useState<View>("overview"),
    [importing, setImporting] = useState(false);
  const model = useMemo(() => (repo ? contentModel(repo) : null), [repo]);
  if (!repo || !model)
    return (
      <EmptyState
        onImported={(data) => {
          setRepo(data);
          setView("overview");
        }}
      />
    );
  return (
    <main className="dynamic-app">
      <aside className="dynamic-sidebar">
        <div className="dbrand">
          <span>RC</span>
          <b>RepoCompass</b>
        </div>
        <button className="current-repo" onClick={() => setImporting(true)}>
          <i>{repo.name[0]?.toUpperCase()}</i>
          <div>
            <b>
              {repo.owner}/{repo.name}
            </b>
            <small>
              {repo.provider} · {repo.files.toLocaleString()} files
            </small>
          </div>
          <em>⌄</em>
        </button>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              onClick={() => setView(n.id)}
              className={view === n.id ? "active" : ""}
            >
              <span>{n.icon}</span>
              {n.label}
              {n.id === "security" && (
                <em>{model.security.filter((x) => x.level !== "Info").length}</em>
              )}
            </button>
          ))}
        </nav>
        <div className="index-status">
          <span>● Index ready</span>
          <small>
            {repo.ignored} paths ignored · {bytes(repo.bytes)}
          </small>
        </div>
      </aside>
      <section className="dynamic-work">
        <header>
          <div>
            <span>{repo.owner}</span>
            <b>/</b>
            <strong>{repo.name}</strong>
          </div>
          <div>
            <select defaultValue={repo.branch} aria-label="Active repository branch">
              {(repo.branches?.length ? repo.branches : [repo.branch]).map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
            <button onClick={() => setImporting(true)}>＋ Import another</button>
          </div>
        </header>
        <div className="dynamic-content">
          {view === "overview" && <Overview repo={repo} model={model} />}{" "}
          {view === "explorer" && <Explorer repo={repo} model={model} />}{" "}
          {view === "impact" && <Impact repo={repo} model={model} />}{" "}
          {view === "ask" && <AskRepo repo={repo} model={model} />}{" "}
          {view === "architecture" && <Architecture repo={repo} model={model} />}{" "}
          {view === "security" && <Security repo={repo} model={model} />}{" "}
          {view === "risks" && <Risks repo={repo} model={model} />}{" "}
          {view === "recommendations" && <Recommendations repo={repo} model={model} />}{" "}
          {view === "evolution" && <Evolution repo={repo} model={model} />}{" "}
          {view === "glossary" && <Glossary repo={repo} model={model} />}{" "}
          {view === "integrations" && (
            <Integrations onImport={() => setImporting(true)} repo={repo} />
          )}{" "}
          {view === "onboarding" && <Onboarding repo={repo} model={model} />}{" "}
          {view === "compare" && <Branches repo={repo} model={model} />}
        </div>
      </section>
      {importing && (
        <ImportModal
          onClose={() => setImporting(false)}
          onImported={(data) => {
            setRepo(data);
            setImporting(false);
            setView("overview");
          }}
        />
      )}
    </main>
  );
}

function EmptyState({ onImported }: { onImported: (r: Repo) => void }) {
  return (
    <main className="empty-state">
      <div className="empty-brand">
        <span>RC</span>RepoCompass
      </div>
      <section>
        <p>EVIDENCE-FIRST CODE INTELLIGENCE</p>
        <h1>Start with a real codebase.</h1>
        <h2>No demo repository. No invented findings.</h2>
        <ImportPanel onImported={onImported} />
        <div className="privacy-row">
          <span>✓ Generated folders ignored</span>
          <span>✓ Local processing available</span>
          <span>✓ Repository code never executed</span>
        </div>
      </section>
    </main>
  );
}
function ImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (r: Repo) => void;
}) {
  return (
    <div className="dmodal-bg">
      <button
        className="modal-backdrop"
        type="button"
        aria-label="Close import dialog"
        onClick={onClose}
      />
      <div className="dmodal">
        <button
          className="modal-x"
          type="button"
          aria-label="Close import dialog"
          onClick={onClose}
        >
          ×
        </button>
        <h2>Analyze another codebase</h2>
        <ImportPanel onImported={onImported} />
      </div>
    </div>
  );
}
function ImportPanel({ onImported }: { onImported: (r: Repo) => void }) {
  const [url, setUrl] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement | null>(null);
  async function remote() {
    if (!url.trim()) return setError("Paste a public repository URL.");
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as AnalyzeRepositoryResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || "Analysis failed");
      onImported({ ...data, source: "remote" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
      setBusy(false);
    }
  }
  async function local(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    const ignoredPaths = new Set(ignored);
    const all = files.map((f) => ({ f, path: f.webkitRelativePath || f.name })),
      accepted = all.filter((x) => !x.path.split("/").some((p) => ignoredPaths.has(p)));
    const root = accepted[0]?.path.split("/")[0] || "local-project",
      langs = new Map<string, number>();
    for (const x of accepted) {
      const e = extensionOf(x.path);
      langs.set(e, (langs.get(e) || 0) + 1);
    }
    const readable = accepted
      .filter(
        (x) =>
          x.f.size <= 120000 &&
          (codeExtensions.has(extensionOf(x.path)) ||
            /[.](json|md|ya?ml|toml|sql|graphql|css|html)$/i.test(x.path)),
      )
      .slice(0, 200);
    const indexedFiles = await Promise.all(
      readable.map(async (x) => ({ path: x.path, size: x.f.size, content: await x.f.text() })),
    );
    onImported({
      owner: "local",
      name: root,
      provider: "Local folder",
      branch: "working-tree",
      branches: ["working-tree"],
      files: accepted.length,
      ignored: all.length - accepted.length,
      bytes: accepted.reduce((s, x) => s + x.f.size, 0),
      languages: [...langs.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count })),
      sampleFiles: accepted.map((x) => x.path),
      indexedFiles,
      source: "local",
    });
  }
  return (
    <div className="import-panel">
      {busy ? (
        <div className="real-indexing">
          <i />
          <h3>Building repository model…</h3>
          <p>
            Reading source, imports, symbols, routes, configuration, tests and security signals.
          </p>
        </div>
      ) : (
        <>
          <label htmlFor="repository-url">PUBLIC GIT REPOSITORY</label>
          <div className="url-row">
            <input
              id="repository-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repository"
            />
            <button onClick={remote}>Analyze URL</button>
          </div>
          <small>GitHub, GitLab and Bitbucket public repositories</small>
          <div className="or">
            <span>or use local files</span>
          </div>
          <div
            className={`real-drop ${drag ? "dragging" : ""}`}
            onDragOver={(e) => e.preventDefault()}
            onDragEnter={() => setDrag(true)}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              void local(Array.from(e.dataTransfer.files));
            }}
          >
            <b>Drop a project folder here</b>
            <p>or open the system file manager</p>
            <button onClick={() => ref.current?.click()}>Select folder</button>
            <input
              hidden
              aria-label="Select local repository folder"
              type="file"
              multiple
              ref={(n) => {
                ref.current = n;
                if (n) n.setAttribute("webkitdirectory", "");
              }}
              onChange={(e) => void local(Array.from(e.target.files || []))}
            />
          </div>
          <div className="ignore-preview">
            <b>Ignored:</b>
            {ignored.map((x) => (
              <code key={x}>{x}</code>
            ))}
          </div>
          {error && <p className="real-error">{error}</p>}
        </>
      )}
    </div>
  );
}

function Title({ k, title, sub }: { k: string; title: string; sub: string }) {
  return (
    <div className="dtitle">
      <span>{k}</span>
      <h1>{title}</h1>
      <p>{sub}</p>
    </div>
  );
}
function Overview({ repo, model }: { repo: Repo; model: Model }) {
  return (
    <>
      <Title
        k="LIVE REPOSITORY MODEL"
        title={`${repo.owner}/${repo.name}`}
        sub={
          repo.description ||
          `Analyzed from ${repo.provider}. Every value below comes from the imported repository tree.`
        }
      />
      <div className="dmetrics">
        <Metric
          label="Indexed files"
          value={repo.files.toLocaleString()}
          note={`${repo.ignored} ignored`}
        />
        <Metric
          label="Source files"
          value={model.sourceFiles.length.toLocaleString()}
          note={`${model.extensions.length} file types`}
        />
        <Metric
          label="Tests"
          value={model.testFiles.length.toLocaleString()}
          note={model.testFiles.length ? "Detected by path" : "None detected"}
        />
        <Metric
          label="Top area"
          value={model.topDirs[0]?.name || "root"}
          note={`${model.topDirs[0]?.count || 0} indexed paths`}
        />
      </div>
      <div className="dash-grid">
        <section className="dcard">
          <h2>Project structure</h2>
          {model.topDirs.slice(0, 7).map((d) => (
            <div className="area" key={d.name}>
              <span>📁 {d.name}</span>
              <i>
                <em
                  style={{
                    width: `${Math.max(5, (d.count / (model.topDirs[0]?.count || 1)) * 100)}%`,
                  }}
                />
              </i>
              <b>{d.count}</b>
            </div>
          ))}
        </section>
        <section className="dcard">
          <h2>Repository makeup</h2>
          {model.extensions.slice(0, 7).map((e) => (
            <div className="makeup" key={e.name}>
              <code>.{e.name}</code>
              <span>{e.count} files</span>
              <b>{Math.round((e.count / Math.max(1, repo.files)) * 100)}%</b>
            </div>
          ))}
        </section>
        <section className="dcard">
          <h2>Analysis coverage</h2>
          {[
            ["Source", model.sourceFiles.length],
            ["Tests", model.testFiles.length],
            ["Configuration", model.configFiles.length],
            ["Documentation", model.docs.length],
            ["CI workflows", model.workflows.length],
          ].map((x) => (
            <div className="coverage-row" key={String(x[0])}>
              <span>{x[0]}</span>
              <b>{x[1]}</b>
            </div>
          ))}
        </section>
        <section className="dcard">
          <h2>Immediate signals</h2>
          {model.security.slice(0, 2).map((s) => (
            <div className="signal" key={s.title}>
              <span className={s.level.toLowerCase()}>{s.level}</span>
              <div>
                <b>{s.title}</b>
                <p>{s.detail}</p>
              </div>
            </div>
          ))}
          {model.risks.slice(0, 2).map((r) => (
            <div className="signal" key={r.title}>
              <span>Risk</span>
              <div>
                <b>{r.title}</b>
                <p>{r.detail}</p>
              </div>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <article>
      <span>{label}</span>
      <b>{value}</b>
      <small>{note}</small>
    </article>
  );
}
type TreeNode = {
  name: string;
  path: string;
  kind: "folder" | "file";
  children: TreeNode[];
  fileCount: number;
};
function makeTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: "root", path: "", kind: "folder", children: [], fileCount: 0 };
  for (const path of paths) {
    const parts = path.split("/").filter(Boolean);
    let parent = root;
    parts.forEach((name, index) => {
      const isFile = index === parts.length - 1;
      let node = parent.children.find((x) => x.name === name);
      if (!node) {
        node = {
          name,
          path: parts.slice(0, index + 1).join("/"),
          kind: isFile ? "file" : "folder",
          children: [],
          fileCount: isFile ? 1 : 0,
        };
        parent.children.push(node);
      }
      parent = node!;
    });
  }
  function count(node: TreeNode): number {
    if (node.kind === "file") return 1;
    node.fileCount = node.children.reduce((sum, child) => sum + count(child), 0);
    node.children.sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "folder" ? -1 : 1,
    );
    return node.fileCount;
  }
  count(root);
  return root.children;
}
function FileGlyph({ path }: { path: string }) {
  const e = extensionOf(path);
  return (
    <span className={`file-glyph ext-${e}`} aria-hidden="true">
      {e === "tsx" || e === "jsx"
        ? "◆"
        : e === "ts" || e === "js"
          ? "JS"
          : e === "json"
            ? "{}"
            : e === "md"
              ? "M"
              : e === "css" || e === "scss"
                ? "#"
                : "▤"}
    </span>
  );
}
function TreeRows({
  nodes,
  expanded,
  setExpanded,
  selected,
  setSelected,
  query,
  depth = 0,
}: {
  nodes: TreeNode[];
  expanded: Set<string>;
  setExpanded: (next: Set<string>) => void;
  selected: string;
  setSelected: (path: string) => void;
  query: string;
  depth?: number;
}) {
  return (
    <>
      {nodes.map((node) => {
        const match =
          !query ||
          node.path.toLowerCase().includes(query.toLowerCase()) ||
          (node.kind === "folder" &&
            node.children.some((child) => child.path.toLowerCase().includes(query.toLowerCase())));
        if (!match) return null;
        const open = expanded.has(node.path) || Boolean(query);
        return (
          <div key={node.path}>
            {node.kind === "folder" ? (
              <button
                className="tree-item tree-folder"
                style={{ paddingLeft: 12 + depth * 18 }}
                aria-expanded={open}
                onClick={() => {
                  const next = new Set(expanded);
                  if (open && !query) next.delete(node.path);
                  else next.add(node.path);
                  setExpanded(next);
                }}
              >
                <span className="tree-chevron">{open ? "▾" : "▸"}</span>
                <span className="folder-glyph" aria-hidden="true">
                  {open ? "📂" : "📁"}
                </span>
                <b>{node.name}</b>
                <em>{node.fileCount}</em>
              </button>
            ) : (
              <button
                className={`tree-item tree-file ${selected === node.path ? "active" : ""}`}
                style={{ paddingLeft: 30 + depth * 18 }}
                onClick={() => setSelected(node.path)}
              >
                <FileGlyph path={node.path} />
                <span>{node.name}</span>
              </button>
            )}
            {node.kind === "folder" && open && (
              <TreeRows
                nodes={node.children}
                expanded={expanded}
                setExpanded={setExpanded}
                selected={selected}
                setSelected={setSelected}
                query={query}
                depth={depth + 1}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
function Explorer({ repo, model }: { repo: Repo; model: Model }) {
  const [q, setQ] = useState(""),
    [selected, setSelected] = useState(repo.sampleFiles[0] || ""),
    [expanded, setExpanded] = useState<Set<string>>(
      () => new Set(model.topDirs.slice(0, 1).map((d) => d.name)),
    );
  const tree = useMemo(() => makeTree(repo.sampleFiles), [repo.sampleFiles]);
  const selectedFile = repo.indexedFiles?.find((f) => f.path === selected);
  return (
    <>
      <Title
        k="CODE EXPLORER"
        title="Repository tree"
        sub={`${repo.files.toLocaleString()} indexed files from ${repo.name}. Folder badges count descendant files only.`}
      />
      <div className="tree-toolbar">
        <div>
          <input
            aria-label="Search repository folders and files"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search folders and files…"
          />
          <span>
            {q
              ? `${repo.sampleFiles.filter((p) => p.toLowerCase().includes(q.toLowerCase())).length} matches`
              : `${repo.files.toLocaleString()} files`}
          </span>
        </div>
        <button onClick={() => setExpanded(new Set(model.topDirs.map((d) => d.name)))}>
          Expand top level
        </button>
        <button onClick={() => setExpanded(new Set())}>Collapse all</button>
      </div>
      <div className="explorer-real tree-explorer">
        <section className="repo-tree" aria-label="Repository file tree">
          <div className="tree-root">
            <span>⑂</span>
            <b>{repo.name}</b>
            <em>{repo.files.toLocaleString()} files</em>
          </div>
          <TreeRows
            nodes={tree}
            expanded={expanded}
            setExpanded={setExpanded}
            selected={selected}
            setSelected={setSelected}
            query={q}
          />
        </section>
        <aside className="file-detail">
          <span>SELECTED FILE</span>
          <h2>{selected.split("/").at(-1) || "Choose a file"}</h2>
          <code>{selected}</code>
          {selected && (
            <dl>
              <dt>Type</dt>
              <dd>.{extensionOf(selected)}</dd>
              <dt>Folder</dt>
              <dd>{selected.split("/").slice(0, -1).join("/") || "root"}</dd>
              <dt>Classification</dt>
              <dd>
                {model.testFiles.includes(selected)
                  ? "Test"
                  : model.configFiles.includes(selected)
                    ? "Configuration"
                    : model.docs.includes(selected)
                      ? "Documentation"
                      : codeExtensions.has(extensionOf(selected))
                        ? "Source"
                        : "Asset"}
              </dd>
              <dt>Content indexed</dt>
              <dd>{selectedFile?.content ? "Yes" : "No"}</dd>
            </dl>
          )}
          {selectedFile?.content ? (
            <pre className="file-preview">
              <code>{selectedFile.content.split("\n").slice(0, 30).join("\n")}</code>
            </pre>
          ) : (
            <p>
              Select any file to inspect its real path and classification. Content preview is shown
              when that file was included in the source-content index.
            </p>
          )}
        </aside>
      </div>
    </>
  );
}
function Impact({ repo, model }: { repo: Repo; model: Model }) {
  const [target, setTarget] = useState(model.sourceFiles[0] || repo.sampleFiles[0] || "");
  const area = target.split("/")[0],
    near = repo.sampleFiles
      .filter(
        (p) =>
          p !== target &&
          (p.startsWith(`${area}/`) ||
            p.split("/").at(-1)?.split(".")[0] === target.split("/").at(-1)?.split(".")[0]),
      )
      .slice(0, 20),
    tests = model.testFiles.filter((p) =>
      p.includes(target.split("/").at(-1)?.split(".")[0] || "__none__"),
    );
  return (
    <>
      <Title
        k="IMPACT LAB"
        title="Path-level blast radius"
        sub="Results are derived from repository paths. Call-graph impact remains explicitly unavailable until content parsing completes."
      />
      <div className="target-select">
        <label>
          Target file
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {model.sourceFiles.slice(0, 500).map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="impact-real">
        <section className="dcard">
          <h2>Structural neighborhood</h2>
          <div className="target-node">
            <span>TARGET</span>
            <code>{target}</code>
          </div>
          {near.map((p) => (
            <div className="neighbor" key={p}>
              <span>{p.startsWith(`${area}/`) ? "same area" : "same basename"}</span>
              <code>{p}</code>
            </div>
          ))}
          {!near.length && <p className="nothing">No related paths detected.</p>}
        </section>
        <aside className="dcard">
          <h2>Change checklist</h2>
          <div className="impact-stat">
            <b>{near.length}</b>
            <span>nearby paths</span>
          </div>
          <div className="impact-stat">
            <b>{tests.length}</b>
            <span>matching tests</span>
          </div>
          <div className="impact-stat">
            <b>{model.workflows.length}</b>
            <span>CI workflows</span>
          </div>
          <p className="honest-note">
            Verified structural proximity only. Import/call relationships require AST analysis.
          </p>
        </aside>
      </div>
    </>
  );
}
function Architecture({ repo, model }: { repo: Repo; model: Model }) {
  return (
    <>
      <Title
        k="ARCHITECTURE"
        title="Repository topology"
        sub={`Top-level boundaries detected from ${repo.sampleFiles.length.toLocaleString()} available indexed paths.`}
      />
      <div className="arch-real">
        {model.topDirs.map((d, i) => (
          <article key={d.name}>
            <span>{String(i + 1).padStart(2, "0")}</span>
            <div>
              <h2>{d.name}</h2>
              <p>
                {d.count} files · {Math.round((d.count / Math.max(1, repo.files)) * 100)}% of
                repository
              </p>
            </div>
            <div className="arch-types">
              {model.extensions
                .filter((e) =>
                  repo.sampleFiles.some(
                    (p) => p.startsWith(`${d.name}/`) && extensionOf(p) === e.name,
                  ),
                )
                .slice(0, 4)
                .map((e) => (
                  <code key={e.name}>.{e.name}</code>
                ))}
            </div>
          </article>
        ))}
      </div>
      <div className="evidence-boundary">
        Topology is verified from file paths. Dependencies and runtime flows are withheld until
        AST/import extraction is available.
      </div>
    </>
  );
}
function Security({ repo, model }: { repo: Repo; model: Model }) {
  return (
    <>
      <Title
        k="SECURITY"
        title="Repository security signals"
        sub="Path and configuration checks from the imported project—never recycled findings from another repository."
      />
      <div className="security-real">
        <section>
          {model.security.map((s) => (
            <article key={s.title}>
              <span className={s.level.toLowerCase()}>{s.level}</span>
              <div>
                <h2>{s.title}</h2>
                <p>{s.detail}</p>
                {s.file && <code>{s.file}</code>}
              </div>
            </article>
          ))}
        </section>
        <aside className="dcard">
          <h2>Coverage boundary</h2>
          <p>
            <b>{repo.sampleFiles.length}</b> paths inspected
          </p>
          <p>
            <b>{model.configFiles.length}</b> configuration files detected
          </p>
          <p>
            <b>{model.workflows.length}</b> CI workflows detected
          </p>
          <hr />
          <p>
            Secret scanning, taint tracking, vulnerable dependencies and SAST require file content
            plus advisory databases. They are not fabricated here.
          </p>
        </aside>
      </div>
    </>
  );
}
function Risks({ repo, model }: { repo: Repo; model: Model }) {
  return (
    <>
      <Title
        k="RISKS & COUPLING"
        title="Structural risk signals"
        sub={`Heuristics computed specifically for ${repo.owner}/${repo.name}.`}
      />
      <div className="risk-real">
        {model.risks.map((r) => (
          <article key={r.title}>
            <div className="score">{r.score}</div>
            <div>
              <span>STRUCTURAL HEURISTIC</span>
              <h2>{r.title}</h2>
              <p>{r.detail}</p>
              {r.file && <code>{r.file}</code>}
            </div>
            <b>{r.score > 70 ? "High" : r.score > 45 ? "Medium" : "Low"}</b>
          </article>
        ))}
      </div>
    </>
  );
}
function Recommendations({ model }: { repo: Repo; model: Model }) {
  return (
    <>
      <Title
        k="RECOMMENDATIONS"
        title="What this repository needs next"
        sub="Every action below is triggered by a detected repository condition."
      />
      <div className="recommend-real">
        {model.recommendations.map((r) => (
          <article key={r.title}>
            <span>{r.priority}</span>
            <div>
              <h2>{r.title}</h2>
              <p>{r.reason}</p>
            </div>
            <button>Review evidence →</button>
          </article>
        ))}
      </div>
    </>
  );
}
function Onboarding({ repo, model }: { repo: Repo; model: Model }) {
  const readme = model.docs.find((p) => /readme/i.test(p)),
    entry =
      model.sourceFiles.find((p) =>
        /(^|\/)(index|main|app|server)\.(ts|tsx|js|jsx|py|go|rs|java)$/i.test(p),
      ) || model.sourceFiles[0];
  return (
    <>
      <Title
        k="CONTRIBUTOR PATH"
        title={`Start contributing to ${repo.name}`}
        sub="A path assembled only from files that exist in this repository."
      />
      <div className="onboard-real">
        {[
          [
            "01",
            "Read project documentation",
            readme || "No README detected—this is the first onboarding gap.",
          ],
          [
            "02",
            "Inspect the likely entry point",
            entry || "No recognized source entry point detected.",
          ],
          [
            "03",
            "Understand configuration",
            model.configFiles[0] || "No common configuration file detected.",
          ],
          [
            "04",
            "Run or add tests",
            model.testFiles[0] || "No test files detected—establish a baseline suite.",
          ],
          ["05", "Review automation", model.workflows[0] || "No CI workflow detected."],
        ].map((x) => (
          <article key={x[0]}>
            <b>{x[0]}</b>
            <div>
              <h2>{x[1]}</h2>
              <code>{x[2]}</code>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
function Branches({ repo }: { repo: Repo; model: Model }) {
  return (
    <>
      <Title
        k="BRANCHES"
        title="Repository branches"
        sub="Only branches returned by the provider are shown. Local folders expose a working-tree snapshot."
      />
      <section className="branch-real">
        <div className="branch-head">
          <span>Branch</span>
          <span>Indexed files</span>
          <span>Status</span>
        </div>
        {(repo.branches?.length ? repo.branches : [repo.branch]).map((b) => (
          <article key={b}>
            <b>⑂ {b}</b>
            <span>{repo.files.toLocaleString()}</span>
            <em>{b === repo.branch ? "Current index" : "Not indexed"}</em>
          </article>
        ))}
      </section>
      <div className="evidence-boundary">
        Cross-branch diffs require each selected branch tree to be fetched and indexed. RepoCompass
        does not reuse a fake comparison.
      </div>
    </>
  );
}

function AskRepo({ repo, model }: { repo: Repo; model: Model }) {
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState("");
  const answer = useMemo(() => {
    const n = asked.toLowerCase();
    if (!asked) return null;
    if (/auth|login|session/.test(n)) {
      const matches = (model.symbols || [])
        .filter((s) => /auth|login|session/i.test(s.name + s.file))
        .slice(0, 8);
      return {
        title: matches.length
          ? "Authentication-related code found"
          : "No authentication implementation verified",
        body: matches.length
          ? `${matches.length} matching definitions were found in the parsed source sample.`
          : "No matching symbol or path was found. RepoCompass will not invent an authentication flow.",
        evidence: matches.map((x) => `${x.file}:${x.line}`),
      };
    }
    if (/route|api|request|endpoint/.test(n)) {
      return {
        title: `${(model.routes || []).length} route definitions detected`,
        body: (model.routes || []).length
          ? "These endpoints were extracted from route declarations in indexed source."
          : "No supported route declarations were found in the content index.",
        evidence: (model.routes || []).slice(0, 10).map((x) => `${x.method} ${x.path} — ${x.file}`),
      };
    }
    const tokens = n.split(/\W+/).filter((x) => x.length > 2),
      matches = (model.symbols || [])
        .filter((s) => tokens.some((t) => (s.name + s.file).toLowerCase().includes(t)))
        .slice(0, 10);
    return {
      title: matches.length
        ? `${matches.length} relevant definitions found`
        : "No supported answer found",
      body: matches.length
        ? "Results are literal symbol/path matches, not a generated explanation."
        : "The indexed evidence does not support a reliable answer to this question.",
      evidence: matches.map((x) => `${x.name} — ${x.file}:${x.line}`),
    };
  }, [asked, model]);
  return (
    <>
      <Title
        k="ASK REPOSITORY"
        title={`Ask ${repo.name}`}
        sub="Answers use only parsed files from the active repository and state when evidence is insufficient."
      />
      <form
        className="ask-real"
        onSubmit={(e) => {
          e.preventDefault();
          setAsked(q);
        }}
      >
        <input
          aria-label="Repository question"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Where is authentication handled?"
        />
        <button type="submit">Search evidence</button>
      </form>
      {answer && (
        <section className="dcard answer-real">
          <span>REPOSITORY EVIDENCE</span>
          <h2>{answer.title}</h2>
          <p>{answer.body}</p>
          {answer.evidence.map((x) => (
            <code key={x}>{x}</code>
          ))}
        </section>
      )}
    </>
  );
}

function Evolution({ repo, model }: { repo: Repo; model: Model }) {
  return (
    <>
      <Title
        k="ARCHITECTURE DRIFT"
        title="Repository history"
        sub="Real commit history from the active provider. Architectural drift scores require comparable indexed snapshots."
      />
      <div className="commit-list">
        {(repo.commits || []).map((c) => (
          <article key={c.sha}>
            <code>{c.sha}</code>
            <div>
              <b>{c.message}</b>
              <p>
                {c.author} ·{" "}
                {c.date ? new Date(c.date).toISOString().slice(0, 10) : "date unavailable"}
              </p>
            </div>
          </article>
        ))}
        {!(repo.commits || []).length && (
          <div className="evidence-boundary">
            Commit history is unavailable for this local snapshot or provider response. No fake
            trend chart is shown.
          </div>
        )}
      </div>
      <div className="dmetrics">
        <Metric
          label="Import edges"
          value={String((model.edges || []).length)}
          note="Current snapshot"
        />
        <Metric
          label="Symbols"
          value={String((model.symbols || []).length)}
          note="Current snapshot"
        />
        <Metric
          label="Dependencies"
          value={String((model.dependencies || []).length)}
          note="Current snapshot"
        />
        <Metric label="Snapshots" value="1" note="Drift needs 2+" />
      </div>
    </>
  );
}

function Glossary({ repo, model }: { repo: Repo; model: Model }) {
  return (
    <>
      <Title
        k="REPOSITORY GLOSSARY"
        title={`${repo.name} vocabulary`}
        sub="Terms are extracted from actual named definitions; descriptions remain deliberately literal."
      />
      <div className="glossary-real">
        {(model.terms || []).map((t) => (
          <article key={t.term + t.evidence}>
            <b>{t.term}</b>
            <p>{t.detail}</p>
            <code>{t.evidence}</code>
          </article>
        ))}
        {!(model.terms || []).length && (
          <div className="evidence-boundary">
            No glossary terms could be extracted from the available content index.
          </div>
        )}
      </div>
    </>
  );
}

function Integrations({ repo, onImport }: { repo: Repo; onImport: () => void }) {
  return (
    <>
      <Title
        k="INTEGRATIONS"
        title="Source and editor connections"
        sub={`The active ${repo.provider} repository is analyzed. Other connections stay available without pretending to be configured.`}
      />
      <div className="integration-real">
        {[
          repo.provider,
          "GitHub",
          "GitLab",
          "Bitbucket",
          "Azure DevOps",
          "Local folder",
          "VS Code",
          "Cursor / MCP",
        ]
          .filter((x, i, a) => a.indexOf(x) === i)
          .map((x) => (
            <article key={x}>
              <span>{x.slice(0, 2).toUpperCase()}</span>
              <div>
                <b>{x}</b>
                <p>
                  {x === repo.provider
                    ? "Active source for this analysis"
                    : x.includes("VS") || x.includes("Cursor")
                      ? "Configuration available after backend deployment"
                      : "Import or connect another codebase"}
                </p>
              </div>
              <em>{x === repo.provider ? "Active" : "Available"}</em>
            </article>
          ))}
      </div>
      <button className="integration-import" onClick={onImport}>
        ＋ Import another repository
      </button>
    </>
  );
}
