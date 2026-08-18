"use client";
import { useMemo, useRef, useState } from "react";
import { contentModel } from "@/lib/analysis/content-model";
import { codeExtensions, extensionOf } from "@/lib/analysis/file-classification";
import { fileGraphDetails, impactedFiles } from "@/lib/analysis/repository-graph-view";
import type { AnalysisResult } from "@/lib/analysis/analysis-result-contract";
import type { RepositoryAnswer } from "@/lib/analysis/repository-question-engine";
import type { CodeGraph } from "@/lib/domain/code-graph";
import type { Repo } from "@/lib/domain/repository";
import type { Model } from "@/lib/domain/repository-model";
import type {
  AnalysisResultResponse,
  AnalysisStatusResponse,
  CreateAnalysisResponse,
} from "@/lib/runtime/analysis-service";

type AnalysisAccess = { analysisId: string; capabilityToken: string };
type ImportedRepository = {
  repo: Repo;
  model?: Model;
  graph?: CodeGraph;
  analysisAccess?: AnalysisAccess;
};
type ApiErrorResponse = { error: { code: string; message: string } };
type BusyStatus = Pick<AnalysisStatusResponse, "status" | "stage" | "progress">;

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
    [serverModel, setServerModel] = useState<Model | null>(null),
    [graph, setGraph] = useState<CodeGraph | null>(null),
    [analysisAccess, setAnalysisAccess] = useState<AnalysisAccess | null>(null),
    [view, setView] = useState<View>("overview"),
    [importing, setImporting] = useState(false);
  const model = useMemo(
    () => (repo ? serverModel || contentModel(repo) : null),
    [repo, serverModel],
  );
  function importRepository(data: ImportedRepository) {
    setRepo(data.repo);
    setServerModel(data.model || null);
    setGraph(data.graph || null);
    setAnalysisAccess(data.analysisAccess || null);
    setView("overview");
  }
  if (!repo || !model) return <EmptyState onImported={importRepository} />;
  return (
    <main className="dynamic-app">
      <aside className="dynamic-sidebar">
        <div className="dbrand">
          <span>RC</span>
          <b>RepoCompass</b>
        </div>
        <button type="button" className="current-repo" onClick={() => setImporting(true)}>
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
              type="button"
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
          <span>
            ● {repo.source === "remote" ? "Immutable snapshot ready" : "Ephemeral working tree"}
          </span>
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
            <select
              defaultValue={repo.branch}
              disabled
              aria-label={
                repo.source === "remote"
                  ? "Pinned repository reference; import again to analyze another ref"
                  : "Ephemeral local working tree reference"
              }
            >
              {(repo.branches?.length ? repo.branches : [repo.branch]).map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
            <button type="button" onClick={() => setImporting(true)}>
              ＋ Import another
            </button>
          </div>
        </header>
        <div className="dynamic-content">
          {view === "overview" && <Overview repo={repo} model={model} graph={graph} />}{" "}
          {view === "explorer" && <Explorer repo={repo} model={model} graph={graph} />}{" "}
          {view === "impact" && <Impact repo={repo} model={model} graph={graph} />}{" "}
          {view === "ask" && <AskRepo repo={repo} model={model} analysisAccess={analysisAccess} />}{" "}
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
            importRepository(data);
            setImporting(false);
          }}
        />
      )}
    </main>
  );
}

function EmptyState({ onImported }: { onImported: (data: ImportedRepository) => void }) {
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
  onImported: (data: ImportedRepository) => void;
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
const stageMessages: Record<AnalysisStatusResponse["stage"], string> = {
  inventory: "Discovering repository files",
  "fetch-content": "Fetching eligible source content",
  analyze: "Building the repository model",
  complete: "Finalizing the immutable snapshot",
};

function apiError(data: unknown, fallback: string) {
  const response = data as Partial<ApiErrorResponse>;
  return response.error?.message || fallback;
}

async function responseJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function ImportPanel({ onImported }: { onImported: (data: ImportedRepository) => void }) {
  const [url, setUrl] = useState(""),
    [busy, setBusy] = useState<"remote" | "local" | null>(null),
    [busyStatus, setBusyStatus] = useState<BusyStatus | null>(null),
    [error, setError] = useState(""),
    [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement | null>(null);
  async function remote() {
    if (!url.trim()) return setError("Paste a public GitHub repository URL.");
    setBusy("remote");
    setBusyStatus(null);
    setError("");
    try {
      const createResponse = await fetch("/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryUrl: url.trim() }),
      });
      const createData = await responseJson(createResponse);
      if (!createResponse.ok)
        throw new Error(apiError(createData, "Analysis could not be started."));
      const created = createData as CreateAnalysisResponse;
      const authorization = { Authorization: `Bearer ${created.capabilityToken}` };
      let status: AnalysisStatusResponse = created;
      setBusyStatus(status);
      for (let attempt = 0; status.status === "queued" || status.status === "running"; attempt++) {
        if (attempt >= 120) throw new Error("Analysis timed out. Try again later.");
        await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 1.5 ** attempt, 5000)));
        const statusResponse = await fetch(
          `/api/analyses/${encodeURIComponent(created.analysisId)}`,
          {
            headers: authorization,
          },
        );
        const statusData = await responseJson(statusResponse);
        if (!statusResponse.ok)
          throw new Error(apiError(statusData, "Analysis status is unavailable."));
        status = statusData as AnalysisStatusResponse;
        setBusyStatus(status);
      }
      if (status.status === "failed" || status.status === "cancelled") {
        throw new Error(status.error?.message || "Analysis did not complete.");
      }
      const resultResponse = await fetch(
        `/api/analyses/${encodeURIComponent(created.analysisId)}/result`,
        { headers: authorization },
      );
      const resultData = await responseJson(resultResponse);
      if (!resultResponse.ok)
        throw new Error(apiError(resultData, "Analysis result is unavailable."));
      const { result } = resultData as AnalysisResultResponse;
      onImported(
        remotePayload(result, {
          analysisId: created.analysisId,
          capabilityToken: created.capabilityToken,
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Analysis failed.");
      setBusy(null);
      setBusyStatus(null);
    }
  }
  async function local(files: File[]) {
    if (!files.length) return;
    setBusy("local");
    setError("");
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
      repo: {
        owner: "local",
        name: root,
        provider: "Local folder",
        branch: "working-tree",
        branches: ["working-tree"],
        files: accepted.length,
        ignored: all.length - accepted.length,
        bytes: accepted.reduce((sum, x) => sum + x.f.size, 0),
        languages: [...langs.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([name, count]) => ({ name, count })),
        sampleFiles: accepted.map((x) => x.path),
        indexedFiles,
        source: "local",
      },
    });
  }
  const progress = busyStatus?.progress;
  return (
    <div className="import-panel">
      {busy ? (
        <div className="real-indexing" aria-live="polite">
          <i />
          <h3>
            {busy === "local"
              ? "Reading ephemeral local working tree"
              : busyStatus
                ? stageMessages[busyStatus.stage]
                : "Starting durable GitHub analysis"}
            …
          </h3>
          <p>
            {busy === "local"
              ? "Files stay in this browser session and are not stored."
              : "The remote analysis is durable and pinned to an immutable commit."}
          </p>
          {progress && (
            <strong>
              {progress.totalUnits
                ? `${progress.completedUnits.toLocaleString()} of ${progress.totalUnits.toLocaleString()}`
                : `${progress.completedUnits.toLocaleString()} completed`}
            </strong>
          )}
        </div>
      ) : (
        <>
          <label htmlFor="repository-url">PUBLIC GITHUB REPOSITORY</label>
          <div className="url-row">
            <input
              id="repository-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://github.com/owner/repository"
            />
            <button type="button" onClick={() => void remote()}>
              Analyze URL
            </button>
          </div>
          <small>
            Public GitHub repositories are analyzed as durable, commit-pinned snapshots.
          </small>
          <div className="or">
            <span>or use ephemeral local files</span>
          </div>
          <div
            className={`real-drop ${drag ? "dragging" : ""}`}
            onDragOver={(event) => event.preventDefault()}
            onDragEnter={() => setDrag(true)}
            onDragLeave={() => setDrag(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDrag(false);
              void local(Array.from(event.dataTransfer.files));
            }}
          >
            <b>Drop a project folder here</b>
            <p>Browser-only and ephemeral; local files are not uploaded.</p>
            <button type="button" onClick={() => ref.current?.click()}>
              Select folder
            </button>
            <input
              hidden
              aria-label="Select local repository folder"
              type="file"
              multiple
              ref={(node) => {
                ref.current = node;
                if (node) node.setAttribute("webkitdirectory", "");
              }}
              onChange={(event) => void local(Array.from(event.target.files || []))}
            />
          </div>
          <div className="ignore-preview">
            <b>Ignored:</b>
            {ignored.map((path) => (
              <code key={path}>{path}</code>
            ))}
          </div>
          {error && <p className="real-error">{error}</p>}
        </>
      )}
    </div>
  );
}

function remotePayload(result: AnalysisResult, analysisAccess: AnalysisAccess): ImportedRepository {
  const { repository, snapshot, model, coverage } = result;
  return {
    repo: {
      owner: repository.owner,
      name: repository.name,
      provider: "GitHub",
      branch: snapshot.requestedRef,
      branches: [snapshot.requestedRef],
      files: coverage.discoveredFiles,
      ignored: coverage.skippedFiles,
      bytes: coverage.discoveredBytes,
      languages: model.extensions,
      sampleFiles: snapshot.manifest.reduce<string[]>((paths, entry) => {
        if (entry.kind === "blob") paths.push(entry.path);
        return paths;
      }, []),
      source: "remote",
    },
    model,
    graph: result.graph,
    analysisAccess,
  };
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
function Overview({ repo, model, graph }: { repo: Repo; model: Model; graph: CodeGraph | null }) {
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
          label={graph ? "Graph nodes" : "Top area"}
          value={graph ? graph.nodes.length.toLocaleString() : model.topDirs[0]?.name || "root"}
          note={
            graph
              ? `${graph.edges.length.toLocaleString()} relationships`
              : `${model.topDirs[0]?.count || 0} indexed paths`
          }
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
function Explorer({ repo, model, graph }: { repo: Repo; model: Model; graph: CodeGraph | null }) {
  const [q, setQ] = useState(""),
    [selected, setSelected] = useState(repo.sampleFiles[0] || ""),
    [expanded, setExpanded] = useState<Set<string>>(
      () => new Set(model.topDirs.slice(0, 1).map((d) => d.name)),
    );
  const tree = useMemo(() => makeTree(repo.sampleFiles), [repo.sampleFiles]);
  const selectedFile = repo.indexedFiles?.find((f) => f.path === selected);
  const graphDetails = useMemo(() => fileGraphDetails(graph, selected), [graph, selected]);
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
          {graph?.schemaVersion === "2.0" && (
            <section aria-label="Graph relationships">
              <h3>Graph relationships</h3>
              <p>
                {graphDetails.symbols.length} symbols · {graphDetails.routes.length} routes ·{" "}
                {graphDetails.relationships.length} relationships
              </p>
              {graphDetails.relationships.slice(0, 20).map((relationship) => (
                <div className="neighbor" key={relationship.edgeId}>
                  <span>
                    {relationship.direction} {relationship.kind}
                  </span>
                  <code>
                    {relationship.path || relationship.name}
                    {relationship.line ? `:${relationship.line}` : ""}
                  </code>
                </div>
              ))}
              {!graphDetails.relationships.length && <p>No graph relationships found.</p>}
            </section>
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
function Impact({ repo, model, graph }: { repo: Repo; model: Model; graph: CodeGraph | null }) {
  const [target, setTarget] = useState(model.sourceFiles[0] || repo.sampleFiles[0] || "");
  const graphImpact = useMemo(() => impactedFiles(graph, target), [graph, target]);
  const area = target.split("/")[0],
    pathImpact = repo.sampleFiles
      .filter(
        (p) =>
          p !== target &&
          (p.startsWith(`${area}/`) ||
            p.split("/").at(-1)?.split(".")[0] === target.split("/").at(-1)?.split(".")[0]),
      )
      .slice(0, 20),
    near = graph?.schemaVersion === "2.0" ? graphImpact.map((item) => item.path) : pathImpact,
    tests = model.testFiles.filter((p) =>
      p.includes(target.split("/").at(-1)?.split(".")[0] || "__none__"),
    );
  return (
    <>
      <Title
        k="IMPACT LAB"
        title={
          graph?.schemaVersion === "2.0" ? "Graph-backed blast radius" : "Path-level blast radius"
        }
        sub={
          graph?.schemaVersion === "2.0"
            ? "Incoming import, require, reference, call, and test relationships. Traversal is cycle-safe and bounded to three hops."
            : "Results are derived from repository paths. Call-graph impact remains unavailable for local imports."
        }
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
          {near.map((p) => {
            const impact = graphImpact.find((item) => item.path === p);
            return (
              <div className="neighbor" key={p}>
                <span>
                  {impact
                    ? `${impact.kinds.join(", ")} · ${impact.depth} hop${impact.depth === 1 ? "" : "s"}`
                    : p.startsWith(`${area}/`)
                      ? "same area"
                      : "same basename"}
                </span>
                <code>{p}</code>
              </div>
            );
          })}
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
            {graph?.schemaVersion === "2.0"
              ? "Verified incoming relationships from immutable snapshot graph."
              : "Verified structural proximity only. Import/call relationships require remote AST analysis."}
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

function AskRepo({
  repo,
  model,
  analysisAccess,
}: {
  repo: Repo;
  model: Model;
  analysisAccess: AnalysisAccess | null;
}) {
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState("");
  const [remoteAnswer, setRemoteAnswer] = useState<RepositoryAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const localAnswer = useMemo(() => {
    const n = asked.toLowerCase();
    if (!asked || analysisAccess) return null;
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
  }, [analysisAccess, asked, model]);
  async function ask() {
    const question = q.trim();
    if (!question) return;
    setAsked(question);
    setRemoteAnswer(null);
    setError("");
    if (!analysisAccess) return;
    setLoading(true);
    try {
      const response = await fetch(
        `/api/analyses/${encodeURIComponent(analysisAccess.analysisId)}/answer`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${analysisAccess.capabilityToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ question }),
        },
      );
      const data = await responseJson(response);
      if (!response.ok) throw new Error(apiError(data, "Repository answer is unavailable."));
      setRemoteAnswer((data as { answer: RepositoryAnswer }).answer);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Repository answer is unavailable.");
    } finally {
      setLoading(false);
    }
  }
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
          void ask();
        }}
      >
        <input
          aria-label="Repository question"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Where is authentication handled?"
        />
        <button type="submit" disabled={loading}>
          {loading ? "Searching…" : "Search evidence"}
        </button>
      </form>
      {error && <p className="real-error">{error}</p>}
      {remoteAnswer && (
        <section className="dcard answer-real">
          <span>REPOSITORY EVIDENCE · {remoteAnswer.confidence.toUpperCase()}</span>
          <h2>
            {remoteAnswer.verifiedFacts.length
              ? `${remoteAnswer.verifiedFacts.length} verified facts`
              : "Insufficient evidence"}
          </h2>
          {remoteAnswer.verifiedFacts.map((fact) => (
            <p key={fact.text}>{fact.text}</p>
          ))}
          {remoteAnswer.unknowns.map((unknown) => (
            <p key={unknown}>{unknown}</p>
          ))}
          {remoteAnswer.citations.map((citation) => (
            <code key={citation.id}>
              {citation.path}
              {citation.startLine ? `:${citation.startLine}` : ""} ·{" "}
              {citation.commitSha.slice(0, 12)}
            </code>
          ))}
        </section>
      )}
      {localAnswer && (
        <section className="dcard answer-real">
          <span>REPOSITORY EVIDENCE</span>
          <h2>{localAnswer.title}</h2>
          <p>{localAnswer.body}</p>
          {localAnswer.evidence.map((x) => (
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

const connections = [
  {
    name: "GitHub",
    detail: "Durable, commit-pinned analysis for public repositories",
    supported: true,
  },
  {
    name: "Local folder",
    detail: "Private, browser-only analysis of an ephemeral working tree",
    supported: true,
  },
  { name: "GitLab", detail: "Durable ingestion is planned", supported: false },
  { name: "Bitbucket", detail: "Durable ingestion is planned", supported: false },
  { name: "Azure DevOps", detail: "Provider support is planned", supported: false },
  { name: "VS Code", detail: "Editor integration is planned", supported: false },
  { name: "Cursor / MCP", detail: "Assistant integration is planned", supported: false },
] as const;

function Integrations({ repo, onImport }: { repo: Repo; onImport: () => void }) {
  return (
    <>
      <Title
        k="INTEGRATIONS"
        title="Source and editor connections"
        sub={`The active ${repo.provider} source is analyzed. Planned connections are labelled explicitly.`}
      />
      <div className="integration-real">
        {connections.map((connection) => {
          const active = connection.name === repo.provider;
          return (
            <article key={connection.name}>
              <span>{connection.name.slice(0, 2).toUpperCase()}</span>
              <div>
                <b>{connection.name}</b>
                <p>{active ? "Active source for this analysis" : connection.detail}</p>
              </div>
              <em>{active ? "Active" : connection.supported ? "Supported" : "Planned"}</em>
            </article>
          );
        })}
      </div>
      <button type="button" className="integration-import" onClick={onImport}>
        ＋ Import another repository
      </button>
    </>
  );
}
