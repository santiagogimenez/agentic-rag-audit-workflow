// Cliente real contra el backend FastAPI, vía src/lib/api.ts::apiFetch. Cada función devuelve
// la forma de src/types/domain.ts para que los componentes la consuman con useQuery/useMutation
// sin lógica adicional.

import { apiFetch } from "@/lib/api";
import type {
  CaseFile,
  ChatMessage,
  ChatSummary,
  Project,
  Report,
  ToolAction,
  ToolCatalogEntry,
  ToolCatalogEntryDraft,
  ToolInstance,
} from "@/types/domain";

// ---------------------------------------------------------------------------
// Proyectos (AuditCase)
// ---------------------------------------------------------------------------

interface AuditCaseApi {
  id: string;
  name: string;
  status: string;
  context: string | null;
  created_at: string;
}

function toProject(c: AuditCaseApi): Project {
  return { id: c.id, name: c.name, status: c.status, context: c.context, updatedAt: c.created_at };
}

export async function getProjects(): Promise<Project[]> {
  const cases = await apiFetch<AuditCaseApi[]>("/audit-cases");
  return cases.map(toProject);
}

export async function getProject(id: string): Promise<Project | undefined> {
  try {
    return toProject(await apiFetch<AuditCaseApi>(`/audit-cases/${id}`));
  } catch {
    return undefined;
  }
}

export async function createProject(name: string, context: string | null = null): Promise<Project> {
  const created = await apiFetch<AuditCaseApi>("/audit-cases", {
    method: "POST",
    body: JSON.stringify({ name, context }),
  });
  return toProject(created);
}

export async function deleteProject(id: string): Promise<void> {
  await apiFetch(`/audit-cases/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Chats y mensajes
// ---------------------------------------------------------------------------

interface ChatApi {
  id: string;
  case_id: string | null;
  title: string | null;
  updated_at: string;
}

function toChatSummary(c: ChatApi): ChatSummary {
  return { id: c.id, caseId: c.case_id, title: c.title, updatedAt: c.updated_at };
}

interface MessageApi {
  id: string;
  chat_id: string;
  role: "user" | "assistant" | "tool";
  content: string | null;
  tool_name: string | null;
  tool_input: Record<string, unknown> | null;
  tool_output: Record<string, unknown> | null;
  report_id: string | null;
  created_at: string;
}

function toChatMessage(m: MessageApi): ChatMessage {
  return {
    id: m.id,
    chatId: m.chat_id,
    role: m.role,
    content: m.content,
    toolName: m.tool_name,
    toolInput: m.tool_input,
    toolOutput: m.tool_output,
    reportId: m.report_id,
    createdAt: m.created_at,
  };
}

export async function getChats(params: { caseId?: string | null; standalone?: boolean } = {}): Promise<ChatSummary[]> {
  const qs = new URLSearchParams();
  if (params.caseId) qs.set("case_id", params.caseId);
  else if (params.standalone) qs.set("standalone", "true");
  const chats = await apiFetch<ChatApi[]>(`/chats?${qs.toString()}`);
  return chats.map(toChatSummary);
}

export async function getChat(id: string): Promise<ChatSummary | undefined> {
  try {
    return toChatSummary(await apiFetch<ChatApi>(`/chats/${id}`));
  } catch {
    return undefined;
  }
}

export async function createChat(caseId: string | null): Promise<ChatSummary> {
  const created = await apiFetch<ChatApi>("/chats", {
    method: "POST",
    body: JSON.stringify({ case_id: caseId }),
  });
  return toChatSummary(created);
}

export async function deleteChat(id: string): Promise<void> {
  await apiFetch(`/chats/${id}`, { method: "DELETE" });
}

export async function getMessages(chatId: string): Promise<ChatMessage[]> {
  const messages = await apiFetch<MessageApi[]>(`/chats/${chatId}/messages`);
  return messages.map(toChatMessage);
}

export async function postMessage(chatId: string, content: string): Promise<ChatMessage[]> {
  const result = await apiFetch<{ messages: MessageApi[] }>(`/chats/${chatId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
  return result.messages.map(toChatMessage);
}

// ---------------------------------------------------------------------------
// Catálogo global de herramientas
// ---------------------------------------------------------------------------

export async function getToolCatalog(): Promise<ToolCatalogEntry[]> {
  return apiFetch<ToolCatalogEntry[]>("/tools");
}

export async function setToolInstalled(key: string, installed: boolean): Promise<ToolCatalogEntry> {
  return apiFetch<ToolCatalogEntry>(`/tools/${key}`, {
    method: "PATCH",
    body: JSON.stringify({ installed }),
  });
}

export async function createTool(draft: ToolCatalogEntryDraft): Promise<ToolCatalogEntry> {
  return apiFetch<ToolCatalogEntry>("/tools", {
    method: "POST",
    body: JSON.stringify({
      key: draft.key || null,
      label: draft.label,
      description: draft.description,
      kind: draft.kind,
      actions: draft.actions,
    }),
  });
}

export async function updateTool(key: string, patch: Omit<ToolCatalogEntryDraft, "key">): Promise<ToolCatalogEntry> {
  return apiFetch<ToolCatalogEntry>(`/tools/${key}`, { method: "PATCH", body: JSON.stringify(patch) });
}

// ---------------------------------------------------------------------------
// Herramientas activas por proyecto
// ---------------------------------------------------------------------------

interface ProjectToolApi {
  tool_key: string;
  enabled: boolean;
  confirm: boolean;
  allowed_action_ids: string[];
}

function toToolInstance(pt: ProjectToolApi): ToolInstance {
  return { key: pt.tool_key, enabled: pt.enabled, confirm: pt.confirm, allowedActionIds: pt.allowed_action_ids };
}

export async function getProjectTools(caseId: string): Promise<ToolInstance[]> {
  const rows = await apiFetch<ProjectToolApi[]>(`/audit-cases/${caseId}/tools`);
  return rows.map(toToolInstance);
}

export async function addProjectTool(caseId: string, key: string): Promise<ToolInstance[]> {
  await apiFetch(`/audit-cases/${caseId}/tools`, { method: "POST", body: JSON.stringify({ tool_key: key }) });
  return getProjectTools(caseId);
}

export async function removeProjectTool(caseId: string, key: string): Promise<ToolInstance[]> {
  await apiFetch(`/audit-cases/${caseId}/tools/${key}`, { method: "DELETE" });
  return getProjectTools(caseId);
}

export async function updateProjectTool(
  caseId: string,
  key: string,
  patch: Partial<Pick<ToolInstance, "enabled" | "confirm" | "allowedActionIds">>,
): Promise<ToolInstance[]> {
  const body: Record<string, unknown> = {};
  if (patch.enabled !== undefined) body.enabled = patch.enabled;
  if (patch.confirm !== undefined) body.confirm = patch.confirm;
  if (patch.allowedActionIds !== undefined) body.allowed_action_ids = patch.allowedActionIds;
  await apiFetch(`/audit-cases/${caseId}/tools/${key}`, { method: "PATCH", body: JSON.stringify(body) });
  return getProjectTools(caseId);
}

// ---------------------------------------------------------------------------
// Fuentes (CaseFile) -- sin remove: son append-only en el backend real (a
// diferencia del mock, que sí permitía "quitar" para agilizar la validación de UX).
// ---------------------------------------------------------------------------

interface CaseFileApi {
  id: string;
  case_id: string;
  filename: string;
  size_bytes: number;
  created_at: string;
}

function humanSize(bytes: number): string {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toCaseFile(f: CaseFileApi): CaseFile {
  return { id: f.id, name: f.filename, sizeLabel: humanSize(f.size_bytes) };
}

export async function getProjectSources(caseId: string): Promise<CaseFile[]> {
  const rows = await apiFetch<CaseFileApi[]>(`/audit-cases/${caseId}/files`);
  return rows.map(toCaseFile);
}

export async function addProjectSources(caseId: string, files: File[]): Promise<CaseFile[]> {
  for (const file of files) {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/audit-cases/${caseId}/files`, { method: "POST", body: formData });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(typeof body.detail === "string" ? body.detail : "Fallo la subida del archivo");
    }
  }
  return getProjectSources(caseId);
}

// ---------------------------------------------------------------------------
// Informes
// ---------------------------------------------------------------------------

interface ReportSectionApi {
  placeholder: string;
  narrative: string;
}

interface ReportApi {
  id: string;
  case_id: string;
  title: string;
  status: Report["status"];
  sections: ReportSectionApi[];
  updated_at: string;
}

function placeholderToHeading(placeholder: string): string {
  return placeholder.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function toReport(r: ReportApi): Report {
  return {
    id: r.id,
    caseId: r.case_id,
    title: r.title,
    status: r.status,
    updatedAt: r.updated_at,
    sections: r.sections.map((s) => ({ heading: placeholderToHeading(s.placeholder), body: s.narrative })),
  };
}

export async function getReports(caseId: string): Promise<Report[]> {
  const rows = await apiFetch<ReportApi[]>(`/reports?case_id=${caseId}`);
  return rows.map(toReport);
}

export async function getReport(id: string): Promise<Report | undefined> {
  try {
    return toReport(await apiFetch<ReportApi>(`/reports/${id}`));
  } catch {
    return undefined;
  }
}

const DEV_APPROVER_ID = "dev-user-0";

export async function setReportStatus(id: string, status: Report["status"]): Promise<Report> {
  return toReport(
    await apiFetch<ReportApi>(`/reports/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status, approved_by: DEV_APPROVER_ID }),
    }),
  );
}

export type { ToolAction };
